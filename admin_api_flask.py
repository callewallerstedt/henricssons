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

FORM_SUBMISSIONS_FILE = 'form_submissions.json'
FORM_PROMPTS_FILE = 'form_prompts.json'

def load_form_prompts():
    """Load form prompts from file or return defaults."""
    default_prompts = {
        'Kapellförfrågan': """Du svarar på inkommande mejl för Henricssons Båtkapell.

Krav för varje svar:

1. Börja alltid med: "Hej {namn}," där {namn} tas från avsändaren om det är tydligt, annars använd "Hej,".

2. Andra meningen ska alltid börja med: "Tack för att du kontaktar oss på Henricssons Båtkapell."

3. Svara kort och professionellt på ärendet.

4. Bekräfta att vi går igenom uppgifterna och återkommer inom kort med pris, leveranstid eller följdfrågor.

5. Endast fråga efter uppgifter som absolut saknas (t.ex. båttyp, modell, vilka delar av kapellet det gäller, eller bilder om inget går att bedöma).

6. Ingen onödig artighet, inget småprat, inga formuleringar som "ha en bra dag".

7. Ingen information om process, priser eller tidsramar som inte är explicit efterfrågade. Hitta aldrig på information.

8. Avsluta alltid med:

Vänliga hälsningar

Niclas Henricsson

Henricssons Båtkapell

Använd Markdown-formatering: använd tomma rader mellan paragrafer för att skapa strukturen. Använd **fetstil** för viktig text om det är lämpligt.""",
        'Fenderförfrågan': """Du svarar på inkommande mejl för Henricssons Båtkapell om fenderstrumpor.

Krav för varje svar:

1. Börja alltid med: "Hej {namn}," där {namn} tas från avsändaren om det är tydligt, annars använd "Hej,".

2. Andra meningen ska alltid börja med: "Tack för att du kontaktar oss på Henricssons Båtkapell."

3. Svara kort och professionellt på ärendet om fenderstrumpor.

4. Bekräfta att vi går igenom uppgifterna och återkommer inom kort med pris, leveranstid eller följdfrågor.

5. Endast fråga efter uppgifter som absolut saknas (t.ex. antal, storlek, logotyp-önskemål).

6. Ingen onödig artighet, inget småprat, inga formuleringar som "ha en bra dag".

7. Ingen information om process, priser eller tidsramar som inte är explicit efterfrågade. Hitta aldrig på information.

8. Avsluta alltid med:

Vänliga hälsningar

Niclas Henricsson

Henricssons Båtkapell

Använd Markdown-formatering: använd tomma rader mellan paragrafer för att skapa strukturen. Använd **fetstil** för viktig text om det är lämpligt.""",
        'Kontakt': """Du svarar på inkommande mejl för Henricssons Båtkapell.

Krav för varje svar:

1. Börja alltid med: "Hej {namn}," där {namn} tas från avsändaren om det är tydligt, annars använd "Hej,".

2. Andra meningen ska alltid börja med: "Tack för att du kontaktar oss på Henricssons Båtkapell."

3. Svara kort och professionellt på ärendet.

4. Bekräfta att vi går igenom uppgifterna och återkommer inom kort med pris, leveranstid eller följdfrågor.

5. Endast fråga efter uppgifter som absolut saknas.

6. Ingen onödig artighet, inget småprat, inga formuleringar som "ha en bra dag".

7. Ingen information om process, priser eller tidsramar som inte är explicit efterfrågade. Hitta aldrig på information.

8. Avsluta alltid med:

Vänliga hälsningar

Niclas Henricsson

Henricssons Båtkapell

Använd Markdown-formatering: använd tomma rader mellan paragrafer för att skapa strukturen. Använd **fetstil** för viktig text om det är lämpligt."""
    }
    
    if os.path.exists(FORM_PROMPTS_FILE):
        try:
            with open(FORM_PROMPTS_FILE, 'r', encoding='utf-8') as f:
                prompts = json.load(f)
                # Merge with defaults to ensure all keys exist
                for key in default_prompts:
                    if key not in prompts:
                        prompts[key] = default_prompts[key]
                return prompts
        except:
            return default_prompts
    return default_prompts

def get_openai_response(prompt, system_prompt=None):
    """Helper function to call OpenAI API."""
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        raise ValueError('OpenAI API key not configured')
    
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    
    messages = []
    if system_prompt:
        messages.append({'role': 'system', 'content': system_prompt})
    messages.append({'role': 'user', 'content': prompt})
    
    payload = {
        'model': 'gpt-4o-mini',
        'messages': messages,
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
        return result['choices'][0]['message']['content']
    else:
        raise Exception(f'OpenAI API error: {response.status_code} - {response.text}')

@app.route('/api/submit_form', methods=['POST', 'OPTIONS'])
def submit_form():
    """Receive form submissions, categorize with AI, generate response, and save to nya-inskick."""
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        form_data = request.get_json()
        if not form_data:
            return jsonify(error='Form data required'), 400
        
        # Extract form fields
        form_type = form_data.get('form_type', 'Kontakt')  # 'Kontakt' or 'Kapellförfrågan'
        fields = form_data.get('fields', {})
        
        # Build a readable summary of the form
        form_summary = f"Formulärtyp: {form_type}\n\n"
        for key, value in fields.items():
            if value:  # Only include non-empty fields
                form_summary += f"{key}: {value}\n"
        
        # Use AI to categorize and generate a title
        category_prompt = f"""Analysera detta formulärinlägg från en kund till Henricssons Båtkapell:

{form_summary}

Kategorisera detta inlägg i en av följande kategorier:
- Kapellförfrågan (kund vill beställa/offert på kapell)
- Allmän fråga (generella frågor om produkter, öppettider, etc.)
- Support/Service (frågor om befintliga beställningar, reparationer)
- Besöksförfrågan (kund vill besöka verkstaden)

Svara ENDAST med kategorinamnet, inget annat."""
        
        try:
            category = get_openai_response(category_prompt, "Du är en expert på att kategorisera kundförfrågningar.")
            category = category.strip()
        except Exception as e:
            category = "Allmän fråga"  # Fallback
            print(f"Error categorizing: {e}")
        
        # Generate a title
        title_prompt = f"""Skapa en kort, beskrivande titel (max 60 tecken) för detta formulärinlägg:

{form_summary}

Svara ENDAST med titeln, inget annat."""
        
        try:
            title = get_openai_response(title_prompt, "Du skapar korta, beskrivande titlar.")
            title = title.strip().replace('"', '').replace("'", "")
            if len(title) > 60:
                title = title[:57] + "..."
        except Exception as e:
            # Fallback title
            name = fields.get('Namn', fields.get('1. Namn', 'Kund'))
            subject = fields.get('Ämne', fields.get('4. Ämne', form_type))
            title = f"{form_type}: {name} - {subject}"
            if len(title) > 60:
                title = title[:57] + "..."
            print(f"Error generating title: {e}")
        
        # Load appropriate system prompt based on form type
        prompts = load_form_prompts()
        # Map form types to prompt keys
        prompt_key = form_type
        if prompt_key not in prompts:
            # Fallback mappings
            if 'kapell' in form_type.lower():
                prompt_key = 'Kapellförfrågan'
            elif 'fender' in form_type.lower():
                prompt_key = 'Fenderförfrågan'
            else:
                prompt_key = 'Kontakt'
        
        system_prompt = prompts.get(prompt_key, prompts['Kontakt'])
        
        # Generate proposed response
        response_prompt = f"""Kundförfrågan:
{form_summary}

Skriv ett mejlsvar enligt instruktionerna. Använd Markdown-formatering: tomma rader mellan paragrafer för strukturen."""
        
        try:
            proposed_response = get_openai_response(response_prompt, system_prompt)
        except Exception as e:
            proposed_response = f"Hej!\n\nTack för ditt meddelande. Vi återkommer så snart vi kan.\n\nMed vänliga hälsningar,\nHenricssons Båtkapell"
            print(f"Error generating response: {e}")
        
        # Create submission object
        import datetime
        submission = {
            'id': f"form_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{os.urandom(4).hex()}",
            'form_type': form_type,
            'category': category,
            'title': title,
            'fields': fields,
            'form_summary': form_summary,
            'proposed_response': proposed_response,
            'timestamp': datetime.datetime.now().isoformat(),
            'status': 'nya-inskick',
            'read': False
        }
        
        # Load existing submissions
        submissions = []
        if os.path.exists(FORM_SUBMISSIONS_FILE):
            try:
                with open(FORM_SUBMISSIONS_FILE, 'r', encoding='utf-8') as f:
                    submissions = json.load(f)
            except:
                submissions = []
        
        # Add new submission
        submissions.append(submission)
        
        # Save to file
        with open(FORM_SUBMISSIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump(submissions, f, indent=2, ensure_ascii=False)
        
        # Also commit to GitHub
        try:
            commit_file_to_github(FORM_SUBMISSIONS_FILE, FORM_SUBMISSIONS_FILE, f'New form submission: {title}')
        except:
            pass  # Don't fail if GitHub commit fails
        
        return jsonify(success=True, submission_id=submission['id'])
        
    except Exception as e:
        return jsonify(error=f'Server error: {str(e)}'), 500

@app.route('/api/get_form_submissions', methods=['GET'])
def get_form_submissions():
    """Get all form submissions."""
    if os.path.exists(FORM_SUBMISSIONS_FILE):
        try:
            with open(FORM_SUBMISSIONS_FILE, 'r', encoding='utf-8') as f:
                return jsonify(json.load(f))
        except Exception as e:
            return jsonify(error=str(e)), 500
    return jsonify([])

@app.route('/api/form_prompts', methods=['GET', 'POST'])
def form_prompts():
    """Get or save form prompts."""
    if request.method == 'GET':
        try:
            prompts = load_form_prompts()
            return jsonify(prompts)
        except Exception as e:
            return jsonify(error=str(e)), 500
    
    # POST - save prompts
    try:
        data = request.get_json()
        with open(FORM_PROMPTS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        # Commit to GitHub
        try:
            commit_file_to_github(FORM_PROMPTS_FILE, FORM_PROMPTS_FILE, 'Update form prompts via admin panel')
        except:
            pass
        
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/api/page_texts', methods=['GET', 'POST'])
def page_texts():
    """Hämta eller spara sidtexter (t.ex. info-kort)."""
    page_texts_file = 'page_texts.json'
    
    if request.method == 'GET':
        # Ladda befintliga texter
        if os.path.exists(page_texts_file):
            try:
                with open(page_texts_file, 'r', encoding='utf-8') as f:
                    return jsonify(json.load(f))
            except Exception as e:
                return jsonify(error=str(e)), 500
        else:
            # Returnera tom struktur om filen inte finns
            return jsonify({
                'announcement': {
                    'text': '## Ny lokal i Kungsbacka\n\nVi har flyttat till större lokaler i Varla industriområde. Vill du besöka oss? Kontakta oss i förväg så vi säkert är på plats och kan hjälpa dig på bästa sätt.\n\nVi har kapell på lager till många modeller från VA-Varuste, MP-Venekuomu och Hansen Protection.'
                }
            })
    
    # POST - spara texter
    try:
        data = request.get_json()
        
        # Spara till fil
        with open(page_texts_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        # Committa till GitHub
        commit_file_to_github('page_texts.json', page_texts_file, 'Update page texts via admin panel')
        
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