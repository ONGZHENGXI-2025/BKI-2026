#!/usr/bin/env python
import subprocess
import os

os.chdir('c:\\projects\\ground_control')
result = subprocess.run(['python', '-m', 'pip', 'freeze'], capture_output=True, text=True)
with open('requirements.txt', 'w') as f:
    f.write(result.stdout)
print('requirements.txt created successfully')
print(f'Total lines: {len(result.stdout.splitlines())}')
