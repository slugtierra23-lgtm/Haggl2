#!/usr/bin/env python3
"""
Agente de IA simple para testear haggl
Recibe peticiones POST y devuelve respuestas
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys

class AgentHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        """Maneja peticiones POST"""
        try:
            # Leer la petición
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)

            user_input = data.get('input', '').strip()
            context = data.get('context', {})

            # Procesar (agente simple)
            if not user_input:
                output = "Por favor proporciona un input"
            else:
                # Analiza sentimientos de forma simple
                positive_words = ['bueno', 'genial', 'excelente', 'perfecto', 'amor', 'feliz']
                negative_words = ['malo', 'horrible', 'terrible', 'odio', 'triste', 'odioso']

                user_lower = user_input.lower()
                pos_count = sum(1 for word in positive_words if word in user_lower)
                neg_count = sum(1 for word in negative_words if word in user_lower)

                if pos_count > neg_count:
                    sentiment = "POSITIVO 😊"
                elif neg_count > pos_count:
                    sentiment = "NEGATIVO 😢"
                else:
                    sentiment = "NEUTRAL 😐"

                output = f"Sentimiento detectado: {sentiment}\nTexto: {user_input}"

            # Respuesta en formato haggl
            response = {
                "output": output,
                "metadata": {
                    "model": "sentiment-analyzer-v1",
                    "tokens_used": len(user_input.split()),
                    "processing_time_ms": 5
                }
            }

            # Enviar respuesta
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))

        except Exception as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_response = {"error": str(e), "output": "Error procesando petición"}
            self.wfile.write(json.dumps(error_response).encode('utf-8'))

    def log_message(self, format, *args):
        """Personalizar logs"""
        print(f"[{self.client_address[0]}] {format % args}", file=sys.stderr)

if __name__ == '__main__':
    PORT = 5000
    server = HTTPServer(('localhost', PORT), AgentHandler)
    print(f"✅ Agente corriendo en http://localhost:{PORT}")
    print(f"📝 Tipo: Analizador de Sentimientos")
    print(f"💰 Precio sugerido: $10/mes")
    print(f"\n🚀 Presiona Ctrl+C para detener\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n❌ Agente detenido")
        sys.exit(0)
