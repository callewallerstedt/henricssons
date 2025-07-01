from flask import Flask, request, jsonify, send_from_directory
import os
import json
import base64

app = Flask(__name__)

@app.route('/api/save_boatdata', methods=['POST'])
def save_boatdata():
    try:
        data = request.get_json()
        with open('boat_data.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
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