🖨️ LCC PISO PRINT

Self-Service Printing Kiosk – Powered by QR Codes & Virtual Coins

---

📖 Overview

LCC PISO PRINT is a complete self‑service printing kiosk system designed for schools, libraries, and coworking spaces.
It allows users to:

1. Start a session by tapping a button on a tablet (or any device).
2. Scan a QR code with their phone to upload a file.
3. Choose print settings (paper size, color, copies).
4. Pay using virtual coins (or real coin acceptor hardware).
5. Print – the file opens automatically on the connected printer/device.

All data is stored locally in JSON files – no database required.
The system includes a full admin dashboard with analytics, print queue management, real‑time logs, and customisable branding.

---

✨ Key Features

🧑‍💻 User Kiosk (Tablet Interface)

· Tap‑to‑start – creates a unique session and generates a QR code.
· QR code upload – users scan the QR with their phone, upload a file (PDF, JPG, PNG, DOC).
· Print settings – choose paper size (A4/Legal), colour mode (B&W/Color), and number of copies.
· Coin payment simulation – insert virtual coins (₱1, ₱5, ₱10) to unlock printing.
· Real‑time progress – animated progress bar during printing.
· Auto‑cleanup – print jobs are automatically removed from the queue after 1 day.

📊 Admin Dashboard

· Overview stats – total savings, today’s earnings, jobs, and pages.
· Earnings chart – last 7 days earnings (real data from print jobs).
· Printer status – display printer name, connection, paper, and ink levels (customisable).
· Print queue – view, open, or delete pending print jobs.
· All print jobs – searchable history of every print (ID, filename, pages, copies, amount, status, time).
· Server logs – live capture of console output (coloured by level: LOG, WARN, ERROR).
· System summary – total users (sessions), copies, pages, and uptime.

⚙️ Settings

· Branding – change logo, inner/outer backgrounds, center icon, and printer image via URL.
· Admin account – update username and password (with current password verification).
· All changes – use SweetAlert2 for confirmations and notifications (no emojis, clean icons).

---

🛠️ Technology Stack

Component Technology
Backend Node.js + Express
File upload Multer
QR generation qrcode
PDF page counting pdf-lib
Charts Chart.js
Icons FontAwesome
Alerts / Modals SweetAlert2
Data storage JSON files (no DB)
Frontend Vanilla HTML/CSS/JS (responsive)
Platform Runs on Termux (Android) or any desktop (Windows/macOS/Linux)

---

🚀 How It Works

1. User taps “TAP TO START” on the tablet screen.
2. A unique session token is generated, and a QR code appears.
3. The user scans the QR with their phone, opening a mobile‑friendly upload page.
4. After uploading, the tablet automatically detects the file and shows the “FILE RECEIVED” screen.
5. The user adjusts settings (paper, colour, copies) – the total price updates instantly.
6. They click “PROCEED TO PAYMENT” and insert virtual coins until the total is covered.
7. The “START PRINTING” button becomes active; clicking it simulates printing (opens the file with the default viewer).
8. The print job is recorded in data.json, and the file is queued/cleaned automatically.

---

📦 Installation (One‑Tap for Termux)

On a fresh Termux installation, run:

```bash
curl -sSL https://raw.githubusercontent.com/jhoward-embedded/LCC-PISO-PRINTER/refs/heads/main/setup.sh | sed 's/\r$//' | bash
```



For Visual Studio Code / Desktop, clone the repo and run npm install && npm start.


---

📝 License

This project is licensed under the MIT License – see the LICENSE file for details.

---

🙏 Acknowledgements

Developed for LIPA CITY COLLEGES – College of Engineering and Technology.
Built with ❤️ by JHoward.

---

GitHub: https://github.com/jhoward-embedded/piso-printer-simulation/
