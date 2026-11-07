(() => {
  if (window.top !== window || document.getElementById('paletteiq-canva-companion-root')) return;

  const host = document.createElement('div');
  host.id = 'paletteiq-canva-companion-root';
  host.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483646;height:100vh;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .shell { position: relative; height: 100vh; width: 392px; transition: width 180ms ease; pointer-events:none; }
    .panel { position:absolute; top:0; right:0; height:100%; width:370px;
      background:#fff9f4; border-left:1px solid #dfc1b1; box-shadow:-8px 0 24px #25120c22;
      overflow:hidden; pointer-events:auto; }
    .panel iframe { width:100%; height:100%; border:0; display:block; }
    .toggle { position:absolute; left:0; top:50%; transform:translateY(-50%);
      width:23px; height:78px; padding:0; border:1px solid #d7b4a3; border-right:0;
      border-radius:10px 0 0 10px; cursor:pointer; color:white; background:#c34b20;
      font:bold 16px system-ui; pointer-events:auto; box-shadow:-2px 2px 10px #25120c22; }
    .shell.collapsed { width:23px; }
    .shell.collapsed .panel { display:none; }
    .toggle:focus-visible { outline:3px solid #5520ca; outline-offset:2px; }
    @media (max-width: 480px) { .shell:not(.collapsed) { width:min(96vw,392px); }
      .panel { width:calc(100% - 23px); } }
    @media (prefers-reduced-motion:reduce) { .shell { transition:none; } }
  `;
  const shell = document.createElement('aside');
  shell.className = 'shell';
  shell.setAttribute('aria-label', 'PaletteIQ Canva Companion');
  const panel = document.createElement('section');
  panel.className = 'panel';
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html?sidebar=1');
  iframe.title = 'Canva Upscaler Companion';
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  panel.appendChild(iframe);
  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.type = 'button';
  const render = collapsed => {
    shell.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '❮' : '❯';
    toggle.title = collapsed ? 'Expand Canva Companion' : 'Collapse Canva Companion';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  render(false);
  toggle.addEventListener('click', async () => {
    const collapsed = !shell.classList.contains('collapsed');
    render(collapsed);
    try { await chrome.storage.local.set({ companionSidebarCollapsed: collapsed }); }
    catch (error) { console.warn('Canva Companion: could not save sidebar state', error); }
  });
  shell.append(panel, toggle);
  shadow.append(style, shell);
  document.documentElement.appendChild(host);
  chrome.storage.local.get('companionSidebarCollapsed').then(data => {
    render(Boolean(data.companionSidebarCollapsed));
  }).catch(() => {});
})();
