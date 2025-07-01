#!/usr/bin/env python3
"""
Enkel server för admin-panelen som kan skriva till JSON-filer
"""

import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import base64

class AdminHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/save_extras':
            # Bakåtkompatibilitet – men spara också till models_meta för nya flödet
            self.save_models_meta(filename='extras_data.json')
        elif self.path == '/api/save_boatdata':
            self.save_boatdata()
        elif self.path == '/api/save_models_meta':
            self.save_models_meta()
        elif self.path == '/api/upload_image':
            self.upload_image()
        else:
            self.send_error(404)
    
    def save_models_meta(self, filename='henricssons_bilder/models_meta.json'):
        """Spara mottagen JSON till angiven fil (default models_meta.json)."""
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data.decode('utf-8'))
            # Se till att mapp finns
            os.makedirs(os.path.dirname(filename), exist_ok=True)
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def save_boatdata(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8'))
            with open('boat_data.json', 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def upload_image(self):
        """Tar emot JSON {data: base64DataURL, rel_path: 'motorbatar/slug/img.jpg'} och sparar bilden."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            payload = self.rfile.read(length)
            obj = json.loads(payload.decode('utf-8'))
            data_url = obj.get('data')
            rel_path = obj.get('rel_path')  # e.g. motorbatar/slug/img.jpg
            if not (data_url and rel_path):
                raise ValueError('data och rel_path krävs')

            header, b64data = data_url.split(',', 1)
            # Bestäm extension från mime-typ
            if 'image/jpeg' in header or 'image/jpg' in header:
                ext = '.jpg'
            elif 'image/png' in header:
                ext = '.png'
            elif 'image/webp' in header:
                ext = '.webp'
            else:
                ext = ''

            # Se till att rel_path har rätt extension
            if ext and not rel_path.lower().endswith(ext):
                rel_path += ext

            abs_path = os.path.join('henricssons_bilder', rel_path.replace('/', os.sep))
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            with open(abs_path, 'wb') as img_f:
                img_f.write(base64.b64decode(b64data))

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'saved_path': rel_path.replace('/', '\\')}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('localhost', 8001), AdminHandler)
    print("Admin-server startad på http://localhost:8001")
    print("Kör detta i en separat terminal medan du använder admin-panelen")
    server.serve_forever() 