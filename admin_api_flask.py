from flask import Flask, request, jsonify, send_from_directory
import os
import json
import base64
import requests

app = Flask(__name__)

# ----------------- GitHub commit helper -----------------
GITHUB_TOKEN = os.getenv('GITHUB_TOKEN')  # sätt detta i Render
GITHUB_OWNER = os.getenv('GITHUB_OWNER', 'callewallerstedt')
GITHUB_REPO  = os.getenv('GITHUB_REPO', 'henricssons')

def commit_file_to_github(repo_path: str, abs_path: str, message: str):
    """Lägg upp (eller uppdatera) en fil i GitHub-repot via Contents-API."""
    if not GITHUB_TOKEN:
        return  # inget token => hoppa över pushen
    api_url = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/contents/{repo_path}"
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github+json'
    }
    # Hämta sha om filen finns sedan tidigare
    sha = None
    try:
        r = requests.get(api_url, headers=headers, timeout=10)
        if r.status_code == 200:
            sha = r.json().get('sha')
    except requests.RequestException:
        pass  # ignorera

    with open(abs_path, 'rb') as f:
        content_b64 = base64.b64encode(f.read()).decode()

    payload = {
        'message': message,
        'content': content_b64,
        'branch': 'main'
    }
    if sha:
        payload['sha'] = sha

    try:
        requests.put(api_url, headers=headers, json=payload, timeout=15)
    except requests.RequestException:
        pass  # tyst fel – påverkar inte API-svaret

@app.route('/api/save_boatdata', methods=['POST'])
def save_boatdata():
    try:
        data = request.get_json()
        with open('boat_data.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        commit_file_to_github('boat_data.json', 'boat_data.json', 'Update boat_data.json via admin panel')
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/api/save_models_meta', methods=['POST'])
def save_models_meta():
    try:
        data = request.get_json()
        os.makedirs('henricssons_bilder', exist_ok=True)
        with open('henricssons_bilder/models_meta.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        commit_file_to_github('henricssons_bilder/models_meta.json', 'henricssons_bilder/models_meta.json', 'Update models_meta.json via admin panel')
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/api/upload_image', methods=['POST'])
def upload_image():
    try:
        obj = request.get_json()
        data_url = obj.get('data')
        rel_path = obj.get('rel_path')
        if not (data_url and rel_path):
            raise ValueError('data och rel_path krävs')
        header, b64data = data_url.split(',', 1)
        if 'image/jpeg' in header or 'image/jpg' in header:
            ext = '.jpg'
        elif 'image/png' in header:
            ext = '.png'
        elif 'image/webp' in header:
            ext = '.webp'
        else:
            ext = ''
        if ext and not rel_path.lower().endswith(ext):
            rel_path += ext
        abs_path = os.path.join('henricssons_bilder', rel_path.replace('/', os.sep))
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        with open(abs_path, 'wb') as img_f:
            img_f.write(base64.b64decode(b64data))
        commit_file_to_github(rel_path.replace('\\', '/'), abs_path, f'Add/update image {rel_path}')
        return jsonify(success=True, saved_path=rel_path.replace('/', '\\'))
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def options(path):
    return '', 200

@app.route('/boat_data.json')
def get_boat_data():
    return send_from_directory('.', 'boat_data.json')

@app.route('/henricssons_bilder/<path:filename>')
def get_henricssons_files(filename):
    return send_from_directory('henricssons_bilder', filename)

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8001))
    app.run(host='0.0.0.0', port=port) 