#!/usr/bin/env python3
import subprocess
import time
import sys

# Start log streaming in background
log_proc = subprocess.Popen(
    ['log', 'stream', '--level', 'debug'],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1
)

# Give log stream a moment to start
time.sleep(1)

# Open the app
print("Opening JapaneseMaple app...")
subprocess.run([
    'open',
    '/Users/riabuz/Library/Developer/Xcode/DerivedData/JapaneseMaple-dvzbbekhgqohcqeltxcgkdpozlht/Build/Products/Debug/JapaneseMaple.app'
])

# Capture logs for 5 seconds
print("Capturing logs for 5 seconds...")
print("-" * 80)

start_time = time.time()
relevant_logs = []

try:
    while time.time() - start_time < 5:
        line = log_proc.stdout.readline()
        if line:
            # Filter for relevant logs
            if any(keyword in line for keyword in ['JapaneseMaple', 'DEBUG', 'Bundle', 'Fallback', 'WebApp', 'Loading', 'WebView']):
                print(line.rstrip())
                relevant_logs.append(line)
finally:
    log_proc.terminate()
    log_proc.wait()

print("-" * 80)
print(f"\nCaptured {len(relevant_logs)} relevant log lines")
