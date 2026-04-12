# Stream Battle v3

## Setup — ONE terminal, ONE port

### 1. Generate SSL cert (first time only)
Replace IP with your Mac's WiFi IP (run: ipconfig getifaddr en0)
```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=192.168.1.212" -addext "subjectAltName=IP:192.168.1.212,IP:127.0.0.1"
```

### 2. Install cert on iPhone (first time only)
- Email cert.pem to yourself
- Open on iPhone → Settings → General → VPN & Device Management → Install
- Settings → General → About → Certificate Trust Settings → toggle ON

### 3. Install & run
```bash
npm install ws
node server.js
```

### 4. Open in browser
- Mac: https://localhost:3000/app.html
- iPhone: https://192.168.1.212:3000/app.html

That's it! No second terminal needed.
