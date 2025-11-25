from flask import Flask, request, jsonify, send_from_directory
import os, json, base64, requests, tempfile
from typing import Optional
import sys
from werkzeug.routing import BaseConverter

app = Flask(__name__)

# Custom converter that excludes /api/* paths
class StaticFileConverter(BaseConverter):
    """Converter that only matches non-API file paths"""
    def to_python(self, value):
        if value.startswith('api/'):
            # Raise ValueError to prevent this route from matching
            raise ValueError(f"Path '{value}' is an API route, not a static file")
        return value
    
    def to_url(self, value):
        return value

# Register the custom converter
app.url_map.converters['staticfile'] = StaticFileConverter

# ----------------- Simple in-memory caches so data kan serveras även om filsystemet är skrivskyddat -----------------
boat_data_cache: Optional[str] = None
models_meta_cache: Optional[str] = None

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
    """Tar emot hela manufacturers-objektet som JSON och sparar det."""
    global boat_data_cache
    try:
        data = request.get_json()
        boat_data_cache = json.dumps(data, indent=2, ensure_ascii=False)

        # Skriv till temporär fil (skrivbar i Render) enbart för GitHub-commit.
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.json') as tmp:
            tmp.write(boat_data_cache)
            tmp_path = tmp.name

        commit_file_to_github('boat_data.json', tmp_path, 'Update boat_data.json via admin panel')
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/api/save_models_meta', methods=['POST'])
def save_models_meta():
    """Tar emot models_meta-objektet."""
    global models_meta_cache
    try:
        data = request.get_json()
        models_meta_cache = json.dumps(data, indent=2, ensure_ascii=False)

        # Temporär fil för commit
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.json') as tmp:
            tmp.write(models_meta_cache)
            tmp_path = tmp.name

        commit_file_to_github('henricssons_bilder/models_meta.json', tmp_path, 'Update models_meta.json via admin panel')
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
    """Add permissive CORS headers so that the static site (different origin) can access the API."""
    response.headers['Access-Control-Allow-Origin'] = '*'
    # Allow common HTTP verbs so that both reads (GET) and writes (POST) work cross-origin.
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def options(path):
    return '', 200

@app.route('/boat_data.json')
def get_boat_data():
    """Returnerar boat_data.json från minnet om fil saknas."""
    if boat_data_cache is not None:
        return app.response_class(boat_data_cache, mimetype='application/json')
    path = 'boat_data.json'
    if os.path.exists(path):
        return send_from_directory('.', 'boat_data.json')
    return jsonify(error='boat_data saknas'), 404

@app.route('/henricssons_bilder/<path:filename>')
def get_henricssons_files(filename):
    """Hämta filer; om det är models_meta.json och ingen fil finns, använd cache."""
    if filename == 'models_meta.json' and models_meta_cache is not None:
        return app.response_class(models_meta_cache, mimetype='application/json')
    full_path = os.path.join('henricssons_bilder', filename)
    if os.path.exists(full_path):
        return send_from_directory('henricssons_bilder', filename)
    return jsonify(error='File not found'), 404

# Register /api/chat route with explicit methods BEFORE static file serving
@app.route('/api/chat', methods=['POST', 'OPTIONS'])
def chat():
    """Chat endpoint som använder OpenAI API."""
    if request.method == 'OPTIONS':
        return '', 200
    try:
        data = request.get_json()
        message = data.get('message', '')
        custom_prompt = data.get('prompt', 'Du är en hjälpsam assistent.')
        
        if not message:
            return jsonify(error='Meddelande krävs'), 400
        
        # OpenAI API key - must be set via environment variable
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            return jsonify(error='OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.'), 500
        
        # Call OpenAI API
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'model': 'gpt-4o-mini',
            'messages': [
                {'role': 'system', 'content': custom_prompt + '\n\nDu kan använda markdown-formatering i dina svar. Använd **fetstil** för viktig text, *kursiv* för betoning, och radbrytningar för att strukturera dina svar.'},
                {'role': 'user', 'content': message}
            ],
            'max_tokens': 1000,
            'temperature': 0.7
        }
        
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            assistant_message = result['choices'][0]['message']['content']
            return jsonify(success=True, response=assistant_message)
        else:
            return jsonify(error=f'OpenAI API error: {response.status_code} - {response.text}'), 500
            
    except requests.RequestException as e:
        return jsonify(error=f'Network error: {str(e)}'), 500
    except Exception as e:
        return jsonify(error=f'Server error: {str(e)}'), 500

if __name__ == '__main__':
    # Local static file serving
    # IMPORTANT: API routes are registered ABOVE (lines 67-197)
    # Flask matches routes in registration order, so API routes should match first
    # But to be absolutely sure, we'll use explicit file serving that doesn't interfere
    
    @app.route('/', methods=['GET'])
    def serve_index():
        return send_from_directory('.', 'index.html')
    
    # Serve static files, but explicitly exclude /api/* paths
    # We'll check if it's an API path BEFORE trying to serve it
    @app.route('/<path:filename>', methods=['GET'])
    def serve_static(filename):
        # CRITICAL: Explicitly reject API routes
        # This should never be reached for /api/* because API routes are registered first
        # But this is a safety check
        if filename.startswith('api/'):
            from flask import abort
            abort(404)
        
        # Only serve actual files
        if os.path.isfile(filename):
            return send_from_directory('.', filename)
        from flask import abort
        abort(404)

    port = int(os.environ.get("PORT", 25565))
    print(f"Starting Flask server on port {port} (host=0.0.0.0)")
    print(f"Admin panel available at: http://localhost:{port}/admin.html")
    print(f"API endpoints available at: http://localhost:{port}/api/...")
    app.run(host='0.0.0.0', port=port, debug=True) 