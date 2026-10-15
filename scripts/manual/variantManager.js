/*variantManager.js*/
(function (global) {
  function normalize(str = '') {
    return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function createBus() {
    const map = new Map();
    return {
      on(evt, fn) { if (!map.has(evt)) map.set(evt, new Set()); map.get(evt).add(fn); },
      off(evt, fn) { const s = map.get(evt); if (s) s.delete(fn); },
      emit(evt, detail) { const s = map.get(evt); if (!s || !s.size) return; for (const fn of Array.from(s)) { try { fn(detail); } catch {} } }
    };
  }

  function createVariantManager() {
    let catalogRef = [];
    const trackIdToIndex = new Map();
    const groupMap = new Map();
    const catalogIndexToVariant = new Map();
    let libraryEntries = [];
    const bus = createBus();

    function resetState() { trackIdToIndex.clear(); groupMap.clear(); catalogIndexToVariant.clear(); libraryEntries = []; catalogRef = []; }
    function buildTrackIndex(catalog = []) {
      catalogRef = Array.isArray(catalog) ? catalog : [];
      trackIdToIndex.clear();
      for (let i = 0; i < catalogRef.length; i++) {
        const track = catalogRef[i];
        if (track && typeof track.id === 'string') trackIdToIndex.set(track.id, i);
      }
    }
    function buildGroupSearchTokens(title, variants) {
      const tokens = new Set();
      if (title) tokens.add(normalize(title));
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (v.normalizedLabel) tokens.add(v.normalizedLabel);
        const t = catalogRef[v.catalogIndex];
        if (t && typeof t._normalizedTitle === 'string') tokens.add(t._normalizedTitle);
        else if (t?.titles?.en) tokens.add(normalize(t.titles.en));
      }
      return Array.from(tokens).filter(Boolean).join(' ');
    }
    function hydrateGroups(rawGroups = []) {
      if (!Array.isArray(rawGroups)) return;
      for (let ri = 0; ri < rawGroups.length; ri++) {
        const raw = rawGroups[ri];
        if (!raw || typeof raw !== 'object') continue;
        const groupId = raw.groupId || raw.id;
        if (!groupId || groupMap.has(groupId)) continue;
        const variants = Array.isArray(raw.variants) ? raw.variants : [];
        if (variants.length < 2) continue;
        const hydrated = [];
        for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
          const variant = variants[variantIndex];
          const variantId = variant?.id;
          if (!variantId) continue;
          const catalogIndex = trackIdToIndex.get(variantId);
          if (typeof catalogIndex !== 'number') continue;
          const variantLabel = (typeof variant.variantLabel === 'string' && variant.variantLabel.trim()) ? variant.variantLabel.trim() : 'Original';
          hydrated.push({ id: variantId, catalogIndex, variantIndex, variantLabel, normalizedLabel: normalize(variantLabel) });
        }
        if (hydrated.length < 2) continue;

        let activeIndex = 0;
        if (typeof raw.defaultVariantId === 'string') {
          const found = hydrated.findIndex((v) => v.id === raw.defaultVariantId);
          if (found >= 0) activeIndex = found;
        }

        const title = (typeof raw.title === 'string' && raw.title.trim()) ? raw.title.trim() : (catalogRef[hydrated[0].catalogIndex]?.titles?.en || '').trim();

        const group = { groupId, title, variants: hydrated, activeIndex, searchTokens: buildGroupSearchTokens(title, hydrated) };
        groupMap.set(groupId, group);

        for (let j = 0; j < hydrated.length; j++) {
          const v = hydrated[j];
          catalogIndexToVariant.set(v.catalogIndex, { groupId, variantLabel: v.variantLabel, variantIndex: v.variantIndex });
        }
      }
    }
    function buildLibraryEntries() {
      const seen = new Set();
      libraryEntries = [];
      for (let i = 0; i < catalogRef.length; i++) {
        const track = catalogRef[i];
        const meta = catalogIndexToVariant.get(i);
        if (!meta) { libraryEntries.push({ type: 'single', catalogIndex: i }); continue; }
        const { groupId } = meta;
        if (seen.has(groupId)) continue;
        const g = groupMap.get(groupId);
        if (!g || g.variants.length < 2) { libraryEntries.push({ type: 'single', catalogIndex: i }); continue; }
        libraryEntries.push({ type: 'group', groupId });
        seen.add(groupId);
      }
      bus.emit('entriesChanged', { total: libraryEntries.length });
    }

    return {
      load({ catalog = [], variantGroups = [] } = {}) {
        resetState(); buildTrackIndex(catalog); hydrateGroups(variantGroups); buildLibraryEntries();
        bus.emit('ready', { groups: groupMap.size, entries: libraryEntries.length });
      },
      getLibraryEntries() { return libraryEntries.slice(); },
      getGroup(groupId) { return groupMap.get(groupId) || null; },
      stepActiveVariant(groupId, delta = 1) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || group.variants.length === 0) return null;
        const len = group.variants.length;
        let next = ((group.activeIndex || 0) + delta) % len;
        if (next < 0) next += len;
        group.activeIndex = next;
        const active = group.variants[group.activeIndex];
        bus.emit('activeChanged', { groupId, activeIndex: group.activeIndex, activeCatalogIndex: active?.catalogIndex, variantLabel: active?.variantLabel });
        return group;
      },
      setActiveVariant(groupId, variantIndex) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || !Number.isInteger(variantIndex)) return null;
        const len = group.variants.length;
        const clamped = ((variantIndex % len) + len) % len;
        group.activeIndex = clamped;
        const active = group.variants[clamped];
        bus.emit('activeChanged', { groupId, activeIndex: clamped, activeCatalogIndex: active?.catalogIndex, variantLabel: active?.variantLabel });
        return group;
      },
      getActiveVariantCatalogIndex(groupId) { const g = groupMap.get(groupId); if (!g || !g.variants || g.variants.length === 0) return undefined; return g.variants[g.activeIndex]?.catalogIndex; },
      findByCatalogIndex(catalogIndex) { return catalogIndexToVariant.get(catalogIndex) || null; },
      getVariantLabelByCatalogIndex(catalogIndex) { const meta = catalogIndexToVariant.get(catalogIndex); return meta ? meta.variantLabel : ''; },
      getVariantMetaByCatalogIndex(catalogIndex) { const meta = catalogIndexToVariant.get(catalogIndex); return meta ? { ...meta } : null; },
      on: bus.on, off: bus.off,
      getGroupIdByCatalogIndex(catalogIndex) { const meta = catalogIndexToVariant.get(catalogIndex); return meta ? meta.groupId : null; },
      isSameGroupDifferentVariant(a, b) {
        const ma = catalogIndexToVariant.get(a); const mb = catalogIndexToVariant.get(b);
        if (!ma || !mb) return false; return ma.groupId === mb.groupId && ma.variantIndex !== mb.variantIndex;
      },
      getSearchTokensForGroup(groupId) { const g = groupMap.get(groupId); return g?.searchTokens || ''; },
      debugSnapshot() {
        return {
          groups: Array.from(groupMap.values()).map((g) => ({
            groupId: g.groupId,
            title: g.title,
            activeIndex: g.activeIndex,
            activeCatalogIndex: g.variants[g.activeIndex]?.catalogIndex,
            variants: g.variants.map((v) => ({ label: v.variantLabel, catalogIndex: v.catalogIndex }))
          })),
          entries: libraryEntries.slice()
        };
      }
    };
  }

  global.createVariantManager = createVariantManager;
})(window);
