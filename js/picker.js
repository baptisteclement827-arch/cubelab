// Menu déroulant maison (remplace <select>, dont la liste suit le style du système).
// picker(el, { label, onChange }) ; .set(items, value) met à jour les options [{ id, name }].
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function picker(el, { label, onChange }) {
  let items = [];
  let value = null;
  let active = -1;
  el.classList.add('picker');
  el.innerHTML = `
    <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="picker-label">${esc(label)}</span>
      <span class="picker-value"></span>
      <svg class="picker-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <ul class="picker-list" role="listbox" aria-label="${esc(label)}" hidden></ul>`;
  const btn = el.querySelector('.picker-btn');
  const list = el.querySelector('.picker-list');

  const render = () => {
    el.querySelector('.picker-value').textContent = items.find(i => i.id === value)?.name ?? '—';
    list.innerHTML = items.map((it, k) => `<li role="option" data-id="${it.id}" aria-selected="${it.id === value}"
      class="${k === active ? 'active' : ''}">${esc(it.name)}</li>`).join('');
  };
  const open = () => {
    active = Math.max(0, items.findIndex(i => i.id === value));
    render();
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const choose = id => {
    close();
    if (id !== value) { value = id; render(); onChange(id); }
  };

  btn.addEventListener('click', () => (list.hidden ? open() : close()));
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) choose(li.dataset.id); });
  el.addEventListener('keydown', e => {
    if (list.hidden) {
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (items[active]) choose(items[active].id);
    } else if (e.key === 'Tab') close();
  });
  document.addEventListener('pointerdown', e => { if (!el.contains(e.target)) close(); });

  return {
    set(newItems, newValue) { items = newItems; value = newValue; render(); },
  };
}
