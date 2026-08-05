#!/data/data/com.termux/files/usr/bin/bash
cd ~/piso-print
ip=$(ip -4 addr show wlan0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
echo "LCC PISO PRINTER starting..."
echo "Open on tablet: http://127.0.0.1:3000"
echo "Open on any device: http://"$ip":3000"
echo "Press Ctrl+C to stop"
node server.js
