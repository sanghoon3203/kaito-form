import base64
import json
from pathlib import Path

here = Path(__file__).parent
html = (here / 'index.html').read_text(encoding='utf-8')
logo = (here / 'logo.png').read_bytes()
data_url = 'data:image/png;base64,' + base64.b64encode(logo).decode('ascii')
complete = (here / 'complete.html').read_text(encoding='utf-8')
worker = (here / 'worker.js').read_text(encoding='utf-8').replace('__HTML__', json.dumps(html, ensure_ascii=False) + '.replace("/logo.png", LOGO)').replace('__COMPLETE__', json.dumps(complete, ensure_ascii=False) + '.replace("/logo.png", LOGO)')
worker = 'const LOGO = ' + json.dumps(data_url) + ';\n' + worker
(here / 'worker-built.js').write_text(worker, encoding='utf-8')
