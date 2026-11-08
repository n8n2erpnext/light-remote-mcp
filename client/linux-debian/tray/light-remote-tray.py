#!/usr/bin/env python3
import json, os, subprocess, webbrowser
try:
    import gi
    gi.require_version('Gtk','3.0'); gi.require_version('AyatanaAppIndicator3','0.1')
    from gi.repository import Gtk, GLib, AyatanaAppIndicator3 as AppIndicator
except Exception as exc:
    raise SystemExit(f'Light Remote tray dependencies unavailable: {exc}')

ROOT=os.environ.get('LIGHT_REMOTE_ROOT','/opt/gpt-operator-agent'); NODE=f'{ROOT}/current/runtime/node'; AGENT=f'{ROOT}/current/device-agent/operator-agent.mjs'; WALL='http://127.0.0.1:5491/'; ICON=os.environ.get('LIGHT_REMOTE_ICON',f'{ROOT}/current/assets/branding/light-remote-mark-256.png'); SERVICE='light-remote-agent.service'; UPDATE='light-remote-update.service'
def run(args,timeout=12): return subprocess.run(args,text=True,capture_output=True,timeout=timeout)
def agent(*args): return run([NODE,AGENT,*args])
def status():
    try:
        r=agent('status'); return json.loads(r.stdout) if r.returncode==0 and r.stdout.strip() else {'error':r.stderr.strip() or 'agent unavailable'}
    except Exception as e: return {'error':str(e)}
def user_systemctl(action,unit): subprocess.Popen(['systemctl','--user',action,unit],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def privileged_systemctl(action,unit):
    cmd=['systemctl',action,unit]
    if os.geteuid()!=0 and subprocess.call(['sh','-lc','command -v pkexec >/dev/null'])==0: cmd=['pkexec',*cmd]
    subprocess.Popen(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
class Tray:
    def __init__(self):
        self.ind=AppIndicator.Indicator.new('light-remote',ICON,AppIndicator.IndicatorCategory.APPLICATION_STATUS);self.ind.set_status(AppIndicator.IndicatorStatus.ACTIVE);self.ind.set_title('Light Remote')
        self.menu=Gtk.Menu();self.state_item=self.item('Starting…',None);self.menu.append(Gtk.SeparatorMenuItem());self.connect_item=self.item('Connect',self.toggle);self.item('Open Local Wall',lambda *_:webbrowser.open(WALL));self.item('Restart Light Remote',lambda *_:user_systemctl('restart',SERVICE));self.item('Check for updates',lambda *_:privileged_systemctl('start',UPDATE));self.item('Stop Light Remote',lambda *_:user_systemctl('stop',SERVICE));self.menu.append(Gtk.SeparatorMenuItem());self.item('Quit tray',lambda *_:Gtk.main_quit());self.menu.show_all();self.ind.set_menu(self.menu);self.refresh();GLib.timeout_add_seconds(5,self.refresh)
    def item(self,label,cb):
        i=Gtk.MenuItem(label=label);i.set_sensitive(cb is not None)
        if cb:i.connect('activate',cb)
        self.menu.append(i);return i
    def toggle(self,*_):
        s=status();connected=bool(s.get('cloudDesiredConnected')) and s.get('cloudState')=='connected';agent('disconnect' if connected else 'connect');self.refresh()
    def refresh(self):
        s=status();connected=bool(s.get('cloudDesiredConnected')) and s.get('cloudState')=='connected';enrolled=bool(s.get('enrolled'));service=run(['systemctl','--user','is-active',SERVICE]).stdout.strip()
        if s.get('error'): label='Error · service '+(service or 'unknown')
        elif not enrolled: label='Running · not linked'
        elif connected: label='Connected · '+str(s.get('connectionPlan') or '').upper()
        else: label='Running · dormant'
        self.state_item.set_label(label);self.connect_item.set_label('Disconnect' if connected else 'Connect');self.connect_item.set_sensitive(enrolled and service=='active');self.ind.set_title('Light Remote — '+label);return True
if __name__=='__main__': Tray();Gtk.main()
