from pathlib import Path
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',b'<< /Length 0 >>\nstream\n\nendstream']
data=bytearray(b'%PDF-1.4\n'); offsets=[0]
for n,obj in enumerate(objects,1):
    offsets.append(len(data)); data.extend(f'{n} 0 obj\n'.encode()+obj+b'\nendobj\n')
start=len(data); data.extend(f'xref\n0 {len(offsets)}\n'.encode()+b'0000000000 65535 f \n')
for offset in offsets[1:]: data.extend(f'{offset:010d} 00000 n \n'.encode())
data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
Path(__file__).with_name('test-drawing.pdf').write_bytes(data)
