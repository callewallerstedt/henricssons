"""
Flask Email Backend for Henricssons Båtkapell

Instructions:
1. Install dependencies:
   pip install Flask Flask-Mail
2. Set environment variables for security:
   - EMAIL_USER: Your Gmail address (sender)
   - EMAIL_PASS: Your Gmail app password
3. Run this script:
   python email_backend.py
4. In your HTML form, set action="/send" and method="POST".

This will send form submissions to calle.wallerstedt@gmail.com.
"""

import os
import re
import json
from flask import Flask, request, jsonify, send_from_directory
from flask_mail import Mail, Message
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='.')

# Config for Flask-Mail
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = os.environ.get('EMAIL_USER')
app.config['MAIL_PASSWORD'] = os.environ.get('EMAIL_PASS')

mail = Mail(app)

# Admin authentication
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"

def check_auth(username, password):
    """Simple authentication check"""
    return username == ADMIN_USERNAME and password == ADMIN_PASSWORD

def parse_js_file():
    """Parse boatData from kapellforfragan_full.js by extracting lines between const boatData = { and the closing };"""
    try:
        with open('kapellforfragan_full.js', 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        start_idx = None
        end_idx = None
        for i, line in enumerate(lines):
            if start_idx is None and 'const boatData = {' in line:
                start_idx = i
            if start_idx is not None and line.strip() == '};':
                end_idx = i
                break
        if start_idx is None or end_idx is None:
            print('Could not find boatData object in file')
            return {}
        # Extract the JS object as text
        js_obj_lines = lines[start_idx:end_idx+1]
        js_obj = ''.join(js_obj_lines)
        # Remove the assignment and trailing semicolon
        js_obj = js_obj.replace('const boatData = ', '').strip()
        if js_obj.endswith(';'):
            js_obj = js_obj[:-1]
        # Now convert to JSON
        js_obj = re.sub(r"'([^']*)':", r'"\1":', js_obj)
        js_obj = re.sub(r"'([^']*)'", r'"\1"', js_obj)
        js_obj = re.sub(r',([ \t\r\n]*[}\]])', r'\1', js_obj)
        js_obj = js_obj.strip()
        if js_obj.startswith('{') and js_obj.endswith('}'):  # Remove trailing ; if present
            pass
        else:
            print('boatData object does not start/end with curly braces')
            return {}
        result = json.loads(js_obj)
        print(f"Successfully parsed {len(result)} manufacturers from kapellforfragan_full.js")
        return result
    except Exception as e:
        print(f"Error parsing JS file: {e}")
        return {}

def py_to_js(obj, indent=0):
    """Konvertera Python-dict till JS-objekt med dubbla citattecken och rätt escaping."""
    IND = '  '
    if isinstance(obj, dict):
        items = []
        for k, v in obj.items():
            items.append(f'{IND*(indent+1)}"{k}": {py_to_js(v, indent+1)}')
        return '{\n' + ',\n'.join(items) + f'\n{IND*indent}}}'
    elif isinstance(obj, list):
        items = [f'{IND*(indent+1)}{py_to_js(x, indent+1)}' for x in obj]
        return '[\n' + ',\n'.join(items) + f'\n{IND*indent}]'
    elif isinstance(obj, str):
        # Escape backslash, double quote, and control chars
        s = obj.replace('\\', r'\\').replace('"', r'\"')
        s = s.replace('\n', r'\n').replace('\r', r'\r')
        return f'"{s}"'
    elif obj is None:
        return 'null'
    elif isinstance(obj, bool):
        return 'true' if obj else 'false'
    else:
        return str(obj)

def update_js_file(boat_data):
    """Update kapellforfragan_full.js with new boat data, always valid JS."""
    try:
        # Read the original file (to preserve comments/header if any)
        with open('kapellforfragan_full.js', 'r', encoding='utf-8') as f:
            content = f.read()

        # Generate JS object string
        js_boat_data = py_to_js(boat_data, indent=0)
        js_code = f'const boatData = {js_boat_data};\n'

        # Eftersom filen bara innehåller boatData-objektet skriver vi helt enkelt över den
        new_content = js_code

        # Kontrollera att det går att parsa tillbaka (validering)
        try:
            test = json.loads(json.dumps(boat_data))
        except Exception as e:
            print(f"Validation error: {e}")
            return False

        # Write back to file
        with open('kapellforfragan_full.js', 'w', encoding='utf-8') as f:
            f.write(new_content)

        return True
    except Exception as e:
        print(f"Error updating JS file: {e}")
        return False

UPLOAD_FOLDER = os.path.join(app.static_folder, 'assets', 'model_images')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def serve_file(filename):
    return send_from_directory('.', filename)

@app.route('/admin')
def admin():
    # Basic auth check
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return send_from_directory('.', 'admin.html')
    return send_from_directory('.', 'admin.html')

@app.route('/api/manufacturers', methods=['GET'])
def get_manufacturers():
    """Get all manufacturers and models"""
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401
    
    boat_data = parse_js_file()
    return jsonify(boat_data)

@app.route('/api/manufacturers', methods=['POST'])
def add_manufacturer():
    return jsonify({'error': 'Deprecated - send full dataset to /api/boatdata'}), 410

@app.route('/api/boatdata', methods=['POST'])
def save_full_boatdata():
    """Replace entire boatData object with posted data"""
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({'error': 'Invalid payload'}), 400

    if update_js_file(data):
        return jsonify({'success': True, 'count': len(data)})
    else:
        return jsonify({'error': 'Failed to update file'}), 500

@app.route('/api/manufacturers/<key>', methods=['DELETE'])
def delete_manufacturer(key):
    """Delete a manufacturer"""
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401
    
    boat_data = parse_js_file()
    if key in boat_data:
        del boat_data[key]
        if update_js_file(boat_data):
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Failed to update file'}), 500
    else:
        return jsonify({'error': 'Manufacturer not found'}), 404

@app.route('/send', methods=['POST'])
def send_email():
    """Send email from contact form"""
    try:
        data = request.get_json()
        
        # Extract form data
        name = data.get('name', '')
        email = data.get('email', '')
        phone = data.get('phone', '')
        message = data.get('message', '')
        tillverkare = data.get('tillverkare', '')
        modell = data.get('modell', '')
        
        # Create email content
        subject = f"Ny kapellförfrågan från {name}"
        body = f"""
Ny kapellförfrågan från hemsidan:

Namn: {name}
Email: {email}
Telefon: {phone}
Tillverkare: {tillverkare}
Modell: {modell}

Meddelande:
{message}
        """
        
        # Send email
        msg = Message(
            subject=subject,
            sender=os.environ.get('EMAIL_USER'),
            recipients=['calle.wallerstedt@gmail.com'],
            body=body
        )
        mail.send(msg)
        
        return jsonify({'success': True, 'message': 'Email sent successfully'})
        
    except Exception as e:
        print(f"Error sending email: {e}")
        return jsonify({'error': 'Failed to send email'}), 500

@app.route('/api/upload_image', methods=['POST'])
def upload_image():
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401

    if 'image' not in request.files:
        return jsonify({'error': 'No image part'}), 400
    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        # ensure unique name
        base, ext = os.path.splitext(filename)
        import time
        filename = f"{base}_{int(time.time())}{ext}"
        save_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(save_path)
        # Return relative path to use in frontend
        rel_path = f"assets/model_images/{filename}"
        return jsonify({'success': True, 'filename': rel_path})
    else:
        return jsonify({'error': 'Invalid file type'}), 400

@app.route('/api/delete_image', methods=['POST'])
def delete_image():
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json()
    path = data.get('path', '')
    if not path.startswith('assets/model_images/'):
        return jsonify({'error': 'Invalid path'}), 400
    file_path = os.path.join(app.static_folder, path.replace('/', os.sep))
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

EXTRAS_FILE = 'extras_data.json'

# ----------- Helper functions for extras data -------------

def load_extras_file():
    """Return extras data as dict from JSON file, or empty dict."""
    if not os.path.exists(EXTRAS_FILE):
        return {}
    try:
        with open(EXTRAS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_extras_file(data):
    """Persist extras data to JSON file."""
    try:
        with open(EXTRAS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Error writing extras file: {e}")
        return False

# ----------------- API routes for extras ------------------

@app.route('/api/extras', methods=['GET'])
def get_extras():
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401

    data = load_extras_file()
    return jsonify(data)

@app.route('/api/extras', methods=['POST'])
def save_extras():
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return jsonify({'error': 'Unauthorized'}), 401

    payload = request.get_json()
    if not isinstance(payload, dict):
        return jsonify({'error': 'Invalid payload'}), 400

    if save_extras_file(payload):
        return jsonify({'success': True, 'count': sum(len(v) for v in payload.values())})
    else:
        return jsonify({'error': 'Failed to save extras'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 