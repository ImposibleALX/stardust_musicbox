(function (global) {
  function normalize(str = '') {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function createVariantManager() {
    let catalogRef = [];
    const trackIdToIndex = new Map();
    const groupMap = new Map();
    const catalogIndexToVariant = new Map();
    let libraryEntries = [];

    function resetState() {
      trackIdToIndex.clear();
      groupMap.clear();
      catalogIndexToVariant.clear();
      libraryEntries = [];
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

    function loadGroups(rawGroups = []) {
      if (!Array.isArray(rawGroups)) return;
      for (const rawGroup of rawGroups) {
        if (!rawGroup || typeof rawGroup !== 'object') continue;
        const groupId = rawGroup.groupId || rawGroup.id;
        if (!groupId || groupMap.has(groupId)) continue;
        const variants = Array.isArray(rawGroup.variants) ? rawGroup.variants : [];
        if (variants.length < 2) continue;

        const hydratedVariants = [];
        variants.forEach((variant, variantIndex) => {
          const variantId = variant?.id;
          if (!variantId) return;
          const catalogIndex = trackIdToIndex.get(variantId);
          if (typeof catalogIndex !== 'number') return;
          const track = catalogRef[catalogIndex];
          const variantLabel = typeof variant.variantLabel === 'string' && variant.variantLabel.trim()
            ? variant.variantLabel.trim()
            : 'Original';

          hydratedVariants.push({
            id: variantId,
            catalogIndex,
            variantIndex,
            variantLabel,
            normalizedLabel: normalize(variantLabel)
          });
        });

        if (hydratedVariants.length < 2) continue;

        let activeIndex = 0;
        if (typeof rawGroup.defaultVariantId === 'string') {
          const foundIndex = hydratedVariants.findIndex(v => v.id === rawGroup.defaultVariantId);
          if (foundIndex >= 0) activeIndex = foundIndex;
        }

        const title = typeof rawGroup.title === 'string' && rawGroup.title.trim()
          ? rawGroup.title.trim()
          : (catalogRef[hydratedVariants[0].catalogIndex]?.titles?.en || '').trim();

        const group = {
          groupId,
          title,
          variants: hydratedVariants,
          activeIndex,
          searchTokens: buildGroupSearchTokens(title, hydratedVariants)
        };

        groupMap.set(groupId, group);
        hydratedVariants.forEach(variant => {
          catalogIndexToVariant.set(variant.catalogIndex, {
            groupId,
            variantLabel: variant.variantLabel,
            variantIndex: variant.variantIndex
          });
        });
      }
    }

    function buildGroupSearchTokens(title, variants) {
      const tokens = new Set();
      if (title) tokens.add(normalize(title));
      variants.forEach(variant => {
        if (variant.normalizedLabel) tokens.add(variant.normalizedLabel);
        const track = catalogRef[variant.catalogIndex];
        if (track && typeof track._normalizedTitle === 'string') {
          tokens.add(track._normalizedTitle);
        }
      });
      return Array.from(tokens).filter(Boolean).join(' ');
    }

    function buildLibraryEntries() {
      const seenGroups = new Set();
      libraryEntries = [];
      catalogRef.forEach((track, index) => {
        const variantMeta = catalogIndexToVariant.get(index);
        if (!variantMeta) {
          libraryEntries.push({ type: 'single', catalogIndex: index });
          return;
        }
        const { groupId } = variantMeta;
        if (seenGroups.has(groupId)) return;
        const group = groupMap.get(groupId);
        if (!group || group.variants.length < 2) {
          libraryEntries.push({ type: 'single', catalogIndex: index });
          return;
        }
        libraryEntries.push({ type: 'group', groupId });
        seenGroups.add(groupId);
      });
    }

    return {
      load({ catalog = [], variantGroups = [] } = {}) {
        resetState();
        buildTrackIndex(catalog);
        loadGroups(variantGroups);
        buildLibraryEntries();
      },
      getLibraryEntries() {
        return libraryEntries.slice();
      },
      getGroup(groupId) {
        return groupMap.get(groupId) || null;
      },
      stepActiveVariant(groupId, delta = 1) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || group.variants.length === 0) return null;
        const length = group.variants.length;
        const nextIndex = ((group.activeIndex || 0) + delta) % length;
        group.activeIndex = nextIndex < 0 ? nextIndex + length : nextIndex;
        return group;
      },
      setActiveVariant(groupId, variantIndex) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || !Number.isInteger(variantIndex)) return null;
        const clamped = ((variantIndex % group.variants.length) + group.variants.length) % group.variants.length;
        group.activeIndex = clamped;
        return group;
      },
      getActiveVariantCatalogIndex(groupId) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || group.variants.length === 0) return undefined;
        return group.variants[group.activeIndex]?.catalogIndex;
      },
      findByCatalogIndex(catalogIndex) {
        return catalogIndexToVariant.get(catalogIndex) || null;
      },
      getVariantLabelByCatalogIndex(catalogIndex) {
        const meta = catalogIndexToVariant.get(catalogIndex);
        return meta ? meta.variantLabel : '';
      }
    };
  }

  global.createVariantManager = createVariantManager;
})(window);
