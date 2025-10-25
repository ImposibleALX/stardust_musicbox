(function (global) {
  // ——— Utils ———
  function normalize(str = '') {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  // Event bus mínimo (sin depender de EventTarget)
  function createBus() {
    const map = new Map(); // evt -> Set<fn>
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, new Set());
        map.get(evt).add(fn);
      },
      off(evt, fn) {
        const s = map.get(evt);
        if (s) s.delete(fn);
      },
      emit(evt, detail) {
        const s = map.get(evt);
        if (!s || s.size === 0) return;
        for (const fn of Array.from(s)) {
          try { fn(detail); } catch (_) { /* noop */ }
        }
      }
    };
  }

  function createVariantManager() {
    // ——— Estado interno ———
    let catalogRef = [];
    const trackIdToIndex = new Map();        // trackId -> catalogIndex
    const groupMap = new Map();              // groupId -> group
    const catalogIndexToVariant = new Map(); // catalogIndex -> { groupId, variantLabel, variantIndex }
    let libraryEntries = [];                 // [{type:'single', catalogIndex} | {type:'group', groupId}]
    const bus = createBus();

    // ——— Helpers internos ———
    function resetState() {
      trackIdToIndex.clear();
      groupMap.clear();
      catalogIndexToVariant.clear();
      libraryEntries = [];
      catalogRef = [];
    }

    function buildTrackIndex(catalog = []) {
      catalogRef = Array.isArray(catalog) ? catalog : [];
      trackIdToIndex.clear();
      catalogRef.forEach((track, index) => {
        if (track && typeof track.id === 'string') {
          trackIdToIndex.set(track.id, index);
        }
      });
    }

    function buildGroupSearchTokens(title, variants) {
      const tokens = new Set();
      if (title) tokens.add(normalize(title));
      variants.forEach(v => {
        if (v.normalizedLabel) tokens.add(v.normalizedLabel);
        const t = catalogRef[v.catalogIndex];
        if (t && typeof t._normalizedTitle === 'string') tokens.add(t._normalizedTitle);
        else if (t?.titles?.en) tokens.add(normalize(t.titles.en));
      });
      return Array.from(tokens).filter(Boolean).join(' ');
    }

    function hydrateGroups(rawGroups = []) {
      if (!Array.isArray(rawGroups)) return;

      for (const raw of rawGroups) {
        if (!raw || typeof raw !== 'object') continue;

        const groupId = raw.groupId || raw.id;
        if (!groupId || groupMap.has(groupId)) continue;

        const variants = Array.isArray(raw.variants) ? raw.variants : [];
        if (variants.length < 2) continue;

        const hydrated = [];
        variants.forEach((variant, variantIndex) => {
          const variantId = variant?.id;
          if (!variantId) return;
          const catalogIndex = trackIdToIndex.get(variantId);
          if (typeof catalogIndex !== 'number') return;
          const variantLabel = (typeof variant.variantLabel === 'string' && variant.variantLabel.trim())
            ? variant.variantLabel.trim()
            : 'Original';
          hydrated.push({
            id: variantId,
            catalogIndex,
            variantIndex,
            variantLabel,
            normalizedLabel: normalize(variantLabel)
          });
        });

        if (hydrated.length < 2) continue;

        let activeIndex = 0;
        if (typeof raw.defaultVariantId === 'string') {
          const found = hydrated.findIndex(v => v.id === raw.defaultVariantId);
          if (found >= 0) activeIndex = found;
        }

        const title =
          (typeof raw.title === 'string' && raw.title.trim())
            ? raw.title.trim()
            : (catalogRef[hydrated[0].catalogIndex]?.titles?.en || '').trim();

        const group = {
          groupId,
          title,
          variants: hydrated,
          activeIndex,
          // tokens precalculados (tu UI ya arma sus propios tokens, pero los dejamos por si los quieres)
          searchTokens: buildGroupSearchTokens(title, hydrated)
        };

        groupMap.set(groupId, group);

        // índice inverso: catalogIndex -> meta de variante
        hydrated.forEach(v => {
          catalogIndexToVariant.set(v.catalogIndex, {
            groupId,
            variantLabel: v.variantLabel,
            variantIndex: v.variantIndex
          });
        });
      }
    }

    function buildLibraryEntries() {
      const seen = new Set();
      libraryEntries = [];

      // Mantener orden del catálogo, colapsando a 1 entrada por grupo
      catalogRef.forEach((track, index) => {
        const meta = catalogIndexToVariant.get(index);
        if (!meta) {
          libraryEntries.push({ type: 'single', catalogIndex: index });
          return;
        }
        const { groupId } = meta;
        if (seen.has(groupId)) return;

        const g = groupMap.get(groupId);
        if (!g || g.variants.length < 2) {
          libraryEntries.push({ type: 'single', catalogIndex: index });
          return;
        }
        libraryEntries.push({ type: 'group', groupId });
        seen.add(groupId);
      });

      // Notificar por si tu UI quisiera reaccionar automáticamente
      bus.emit('entriesChanged', { total: libraryEntries.length });
    }

    // ——— API pública ———
    return {
      // 1) Carga catálogo y grupos (sin persistencia; cada recarga inicia "normal")
      load({ catalog = [], variantGroups = [] } = {}) {
        resetState();
        buildTrackIndex(catalog);
        hydrateGroups(variantGroups);
        buildLibraryEntries();
        bus.emit('ready', { groups: groupMap.size, entries: libraryEntries.length });
      },

      // 2) Entradas para la librería (tu UI ya las usa)
      getLibraryEntries() {
        return libraryEntries.slice();
      },

      // 3) Obtener grupo por id (tu UI ya lo usa)
      getGroup(groupId) {
        return groupMap.get(groupId) || null;
      },

      // 4) Cambiar variante activa (◀ ▶). **La activa es la que se arrastra**.
      stepActiveVariant(groupId, delta = 1) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || group.variants.length === 0) return null;
        const len = group.variants.length;
        const next = ((group.activeIndex || 0) + delta) % len;
        group.activeIndex = next < 0 ? next + len : next;

        const active = group.variants[group.activeIndex];
        bus.emit('activeChanged', {
          groupId,
          activeIndex: group.activeIndex,
          activeCatalogIndex: active?.catalogIndex,
          variantLabel: active?.variantLabel
        });

        return group;
      },

      // 5) Fijar variante activa por índice (clamped)
      setActiveVariant(groupId, variantIndex) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || !Number.isInteger(variantIndex)) return null;
        const len = group.variants.length;
        const clamped = ((variantIndex % len) + len) % len;
        group.activeIndex = clamped;

        const active = group.variants[clamped];
        bus.emit('activeChanged', {
          groupId,
          activeIndex: clamped,
          activeCatalogIndex: active?.catalogIndex,
          variantLabel: active?.variantLabel
        });

        return group;
      },

      // 6) catalogIndex de la variante activa del grupo (drag por defecto)
      getActiveVariantCatalogIndex(groupId) {
        const g = groupMap.get(groupId);
        if (!g || !g.variants || g.variants.length === 0) return undefined;
        return g.variants[g.activeIndex]?.catalogIndex;
      },

      // 7) Meta por catalogIndex (para mostrar [label] ≠ 'Original')
      findByCatalogIndex(catalogIndex) {
        return catalogIndexToVariant.get(catalogIndex) || null;
      },
      getVariantLabelByCatalogIndex(catalogIndex) {
        const meta = catalogIndexToVariant.get(catalogIndex);
        return meta ? meta.variantLabel : '';
      },
      getVariantMetaByCatalogIndex(catalogIndex) {
        const meta = catalogIndexToVariant.get(catalogIndex);
        return meta ? { ...meta } : null;
      },

      // 8) Utilidades opcionales (pueden ayudarte más adelante)
      on: bus.on,
      off: bus.off,
      getGroupIdByCatalogIndex(catalogIndex) {
        const meta = catalogIndexToVariant.get(catalogIndex);
        return meta ? meta.groupId : null;
      },
      isSameGroupDifferentVariant(a, b) {
        const ma = catalogIndexToVariant.get(a);
        const mb = catalogIndexToVariant.get(b);
        if (!ma || !mb) return false;
        return ma.groupId === mb.groupId && ma.variantIndex !== mb.variantIndex;
      },
      getSearchTokensForGroup(groupId) {
        const g = groupMap.get(groupId);
        return g?.searchTokens || '';
      },
      debugSnapshot() {
        return {
          groups: Array.from(groupMap.values()).map(g => ({
            groupId: g.groupId,
            title: g.title,
            activeIndex: g.activeIndex,
            activeCatalogIndex: g.variants[g.activeIndex]?.catalogIndex,
            variants: g.variants.map(v => ({
              label: v.variantLabel,
              catalogIndex: v.catalogIndex
            }))
          })),
          entries: libraryEntries.slice()
        };
      }
    };
  }

  global.createVariantManager = createVariantManager;
})(window);