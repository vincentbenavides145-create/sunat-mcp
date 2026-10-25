// Fixed local operations only. The MCP never accepts script supplied by a model.
(args) => {
  const official = location.protocol === 'https:' && (location.hostname === 'sunat.gob.pe' || location.hostname.endsWith('.sunat.gob.pe'));
  if (!official || /loginMenuSol|\/oauth2\/login\/?$/i.test(location.pathname) || document.querySelector('input[type="password"]')) throw new Error('cdp_authentication_required');
  const key = Symbol.for('sunat-mcp-cdp-elements');
  let state = window[key];
  if (!state || args.operation === 'snapshot' && state.adapterRevision !== args.adapterRevision) {
    state = window[key] = { adapterRevision: args.adapterRevision, documentId: crypto.randomUUID(), nextId: 0, ids: new WeakMap(), elements: new Map() };
  }
  if (state.adapterRevision !== args.adapterRevision) throw new Error('stale_reference');
  const normalize = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
  const solMenu = location.hostname === 'e-menu.sunat.gob.pe' && /^\/cl-ti-itmenu\/MenuInternet\.htm$/i.test(location.pathname);
  const accountMenu = location.hostname === 'e-menu.sunat.gob.pe' && /^\/(?:cl-ti-itmenu\/MenuInternet|cl-ti-itmenu2\/MenuInternetPlataforma|cl-ti-itmenucabina\/MenuInternet)\.htm$/i.test(location.pathname);
  const sensitive = (el) => /password|passwd|contrase|clave|usuario|username|user.?id|token|cookie|secret|credential|autenticacion/i.test([el.type, el.name, el.id, el.getAttribute('aria-label'), el.autocomplete].join(' '));
  const available = (el) => {
    const style = getComputedStyle(el);
    return !el.hidden && el.getAttribute('aria-hidden') !== 'true' && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0' && style.contentVisibility !== 'hidden';
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return available(el) && rect.width > 0 && rect.height > 0;
  };
  const nameOf = (el) => {
    const labelled = el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    const buttonValue = el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) ? el.value : '';
    return normalize(el.getAttribute('aria-label') || labelled || Array.from(el.labels ?? []).map((label) => label.textContent).join(' ') || el.getAttribute('alt') || buttonValue || el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || el.name || el.id);
  };
  if (args.operation === 'account') {
    // Restrict identity to the top-level SOL account header. A customer's RUC
    // in a form or iframe must never prove the emitter's identity.
    if (!accountMenu) return undefined;
    const header = document.getElementById('divCabecera');
    if (!header) return undefined;
    const texts = [];
    const read = (el) => {
      if (!available(el) || /^(INPUT|TEXTAREA|SELECT|SCRIPT|STYLE|IFRAME)$/.test(el.tagName)) return;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && visible(el)) texts.push(child.textContent);
        else if (child instanceof Element) read(child);
      }
    };
    read(header);
    const values = [...new Set([...texts.join(' ').matchAll(/\bRUC\s*[:#-]?\s*(\d{11})(?!\d)/gi)].map((match) => match[1]))];
    return values.length === 1 ? values[0] : undefined;
  }
  if (args.operation === 'snapshot') {
    const nextElements = new Map();
    const visit = (el, inheritedHidden = false, inMenu = false) => {
      if (!(el instanceof Element) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|IFRAME|FRAME)$/.test(el.tagName)) return [];
      const hidden = inheritedHidden || !available(el);
      if (hidden) return [];
      const tag = el.tagName;
      const role = el.getAttribute('role')?.toLowerCase();
      // SOL delegates its handlers: these rows have neither href nor onclick.
      // liCuerpo is a submenu container, not a second selectable service.
      const solMenuRoot = solMenu && (el.id === 'divTodasOpciones' || tag === 'UL' && el.classList.contains('ulMenu'));
      const menu = inMenu || solMenuRoot || el.id === 'divSubMenuIzquierda' || /^(menu|menubar|tree)$/.test(role ?? '') || tag === 'NAV';
      const menuContainer = menu && el.classList.contains('liCuerpo');
      const profileTab = solMenu && /^divOpcionServicio[123]$/.test(el.id) && el.classList.contains('divOpcionServicio');
      // SOL can render an identical delegated service row twice in the same
      // submenu. Collapse only exact sibling copies, never equal labels from
      // another branch/profile or rows with different attributes/actions.
      if (solMenu && menu && tag === 'LI' && el.classList.contains('liOpcion') && /^nivel[1-4]_[\d_]+$/.test(el.id) && !el.querySelector('li') && el.parentElement) {
        const copies = Array.from(el.parentElement.children).filter((other) => other.tagName === 'LI' && other.id === el.id && other.outerHTML === el.outerHTML && visible(other));
        const preferred = copies.find((other) => {
          const box = other.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
        }) ?? copies[0];
        if (preferred && preferred !== el) return [];
      }
      const input = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || el.isContentEditable;
      if (tag === 'INPUT' && el.type === 'hidden') return [];
      if (input && sensitive(el)) return [];
      let type = ({ button: 'Button', link: 'Hyperlink', checkbox: 'CheckBox', radio: 'RadioButton', combobox: 'ComboBox', textbox: 'Edit', tab: 'TabItem', menuitem: 'MenuItem', treeitem: 'TreeItem', option: 'ListItem', menu: 'Menu', menubar: 'MenuBar', tree: 'Tree' })[role];
      type ??= solMenuRoot ? 'Menu' : profileTab ? 'TabItem' : menuContainer ? 'Group'
        : tag === 'BUTTON' || tag === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) ? 'Button'
        : tag === 'A' && (el.hasAttribute('href') || el.onclick || el.getAttribute('onclick')) ? 'Hyperlink'
        : tag === 'SELECT' ? 'ComboBox' : tag === 'OPTION' ? 'ListItem'
        : tag === 'INPUT' && el.type === 'checkbox' ? 'CheckBox'
        : tag === 'INPUT' && el.type === 'radio' ? 'RadioButton'
        : input ? 'Edit' : tag === 'LI' && (menu || el.onclick || el.getAttribute('onclick')) ? 'ListItem'
        : el.onclick || el.getAttribute('onclick') ? 'Custom' : 'Group';
      const rect = el.getBoundingClientRect();
      const interactive = /^(Button|Hyperlink|CheckBox|RadioButton|ComboBox|Edit|TabItem|MenuItem|TreeItem|ListItem|Custom)$/.test(type) && rect.width > 0 && rect.height > 0;
      let selector;
      if (interactive) {
        let id = state.ids.get(el);
        if (!id) { id = String(++state.nextId); state.ids.set(el, id); }
        nextElements.set(id, el);
        selector = id;
      }
      const option = tag === 'OPTION' && el.closest('select');
      const bounds = option ? option.getBoundingClientRect() : rect;
      let name = interactive ? nameOf(el) : '';
      if (interactive && menu && tag === 'LI') {
        const ownLabel = el.cloneNode(true);
        ownLabel.querySelectorAll('ul,ol,li,[role="menuitem"],[role="treeitem"],[role="option"]').forEach((child) => child.remove());
        name = normalize(ownLabel.textContent);
      }
      const node = { type, ...(interactive ? { name, selector, isEnabled: !el.matches(':disabled') && !el.readOnly && el.getAttribute('aria-disabled') !== 'true', isOffscreen: bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.top >= innerHeight || bounds.right <= 0 || bounds.left >= innerWidth, isInvokable: !input && type !== 'ListItem', isEditable: type === 'Edit' || type === 'ComboBox', value: input ? String(el.value ?? el.textContent ?? '') : undefined, toggleState: type === 'CheckBox' || type === 'RadioButton' ? String(el.checked) : undefined, isSelected: tag === 'OPTION' ? el.selected : el.getAttribute('aria-selected') === 'true' } : {}), automationId: el.id || undefined, children: [] };
      if (solMenu && menu && tag === 'LI' && !menuContainer) {
        const sibling = el.nextElementSibling;
        const submenu = sibling?.classList.contains('liCuerpo') ? sibling : Array.from(el.children).find((child) => /^(UL|OL)$/.test(child.tagName));
        if (submenu) node.expandState = available(submenu) && submenu.getBoundingClientRect().height > 0 ? 'expanded' : 'collapsed';
      }
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (!interactive && normalize(child.textContent)) node.children.push({ type: 'Text', name: normalize(child.textContent) });
        } else node.children.push(...visit(child, hidden, menu));
      }
      if (el.shadowRoot) for (const child of el.shadowRoot.children) node.children.push(...visit(child, hidden, menu));
      return node.children.length || interactive || el.id === 'divSubMenuIzquierda' ? [node] : [];
    };
    const children = visit(document.body ?? document.documentElement);
    state.elements = nextElements;
    return { documentId: state.documentId, url: location.href, title: document.title, focused: document.hasFocus(), children };
  }
  if (args.operation === 'scroll') {
    const vertical = args.direction === 'up' || args.direction === 'down';
    const containers = Array.from(document.querySelectorAll('body *')).filter((el) => visible(el) && (vertical ? el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY) : el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)));
    const target = containers.at(-1) ?? document.scrollingElement;
    if (!target) throw new Error('no_scroll_container');
    target.scrollBy({ left: vertical ? 0 : args.direction === 'left' ? -450 : 450, top: !vertical ? 0 : args.direction === 'up' ? -450 : 450, behavior: 'instant' });
    return true;
  }
  if (state.documentId !== args.documentId) throw new Error('stale_reference');
  const el = state.elements.get(args.id);
  if (!el?.isConnected || !available(el) || el.matches(':disabled') || el.readOnly || sensitive(el)) throw new Error('stale_reference');
  if (args.operation === 'element') return el;
  if (args.operation === 'entry-point') {
    if (location.hostname !== 'www.sunat.gob.pe' || location.pathname !== '/sol.html') return undefined;
    const link = el.closest('a');
    const href = link?.getAttribute('href')?.trim();
    const functions = {
      'javascript:declaraSimplificadaNueva()': 'declaraciones-pagos',
      'javascript:tramiteConsulta()': 'tramites-consultas',
      'javascript:rentaPersona()': 'renta-anual-personas',
      'javascript:rentaEmpresa()': 'renta-anual-empresas',
    };
    if (Object.prototype.hasOwnProperty.call(functions, href)) return functions[href];
    if (link?.href === 'https://e-renta.sunat.gob.pe/loader/recaudaciontributaria/declaracionpago/formularios?idFormulario=menu') return 'renta-anual-personas';
    return undefined;
  }
  if (args.operation === 'scroll-element') {
    let target = el;
    if (el.tagName === 'LI') {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (/[\p{L}\p{N}]/u.test(node.textContent ?? '') && node.parentElement?.closest('li') === el && available(node.parentElement)) { target = node.parentElement; break; }
    }
    // SOL has a sticky sidebar header. Aligning a row to the top hides its
    // label behind that header; centre its own label instead of the submenu.
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return true;
  }
  if (args.operation === 'point') {
    const measurePoint = () => {
    if (!el.isConnected || state.documentId !== args.documentId || state.elements.get(args.id) !== el || !available(el)) throw new Error('stale_reference');
    // An expanded LI encloses its submenu. Its geometric centre can hit a
    // different service; use its own rendered label, excluding nested items.
    const box = el.getBoundingClientRect();
    let point = el.tagName === 'LI' ? undefined : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    if (!point) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!/[\p{L}\p{N}]/u.test(node.textContent ?? '') || node.parentElement?.closest('li') !== el || !available(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        break;
      }
    }
    if (!point || point.x < 0 || point.y < 0 || point.x >= innerWidth || point.y >= innerHeight) throw new Error('label_not_clickable');
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !el.contains(hit) || el.tagName === 'LI' && hit.closest('li') !== el) throw new Error('target_obscured');
    return { x: point.x - box.left, y: point.y - box.top };
    };
    // SOL animates submenu height with jQuery. During slideDown the text has
    // coordinates but its ancestor still clips the hit target. Wait for that
    // existing animation queue, without another click, screenshot or polling.
    if (solMenu && el.tagName === 'LI' && typeof window.jQuery === 'function' && typeof window.jQuery.fn?.jquery === 'string') {
      const animated = window.jQuery(el).parents().addBack().filter(':animated');
      if (animated.length) return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('target_obscured')), 5500);
        animated.promise().done(() => {
          clearTimeout(timer);
          try { resolve(measurePoint()); } catch (error) { reject(error); }
        });
      });
    }
    return measurePoint();
  }
  throw new Error('unsupported_operation');
}
