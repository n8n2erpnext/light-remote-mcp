"""Package only the canonical extension source, with exact Git/hash provenance."""
import hashlib,json,pathlib,subprocess,sys,zipfile
root=pathlib.Path(__file__).resolve().parents[2]
source=root/'extensions/light-remote-lm-abv2'
out=root/(sys.argv[1] if len(sys.argv)>1 else 'build-output/memory-extension')
assert out.resolve().is_relative_to(root.resolve());out.mkdir(parents=True,exist_ok=True)
manifest=json.loads((source/'manifest.json').read_text())
names=['manifest.json','popup.html','popup.css','popup.js','pair.html','pair.js','background.js','shared.js','capture.js','wall.js','watch.js','restore.js','icon.png','GoogleSans-Variable.ttf','GoogleSans-OFL-1.1.txt','README.md']
assert set(names)=={p.name for p in source.iterdir() if p.is_file()},'Review new extension package files explicitly'
def git(*args):return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
receipt={'sourceCommit':git('rev-parse','HEAD'),'sourceTree':git('rev-parse','HEAD^{tree}'),'extensionVersion':manifest['version'],'productVersion':(root/'VERSION').read_text().strip(),'physicalChromeAcceptance':False,'files':{n:hashlib.sha256((source/n).read_bytes()).hexdigest() for n in names}}
archive=out/('Light-Remote-Memory-v'+manifest['version']+'.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for n in sorted(names):z.write(source/n,'light-remote-memory/'+n)
 z.writestr('EXTENSION_SOURCE_MANIFEST.json',json.dumps(receipt,indent=2)+'\n')
receipt.update(archive=archive.name,archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),bytes=archive.stat().st_size)
(out/'EXTENSION_ARTIFACT_MANIFEST.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k] for k in ['sourceCommit','extensionVersion','archive','archiveSha256','bytes']}))
