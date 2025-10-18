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
    const variantsInUse = new Map();
    let libraryEntries = [];

    function resetState() {
      trackIdToIndex.clear();
      groupMap.clear();
      catalogIndexToVariant.clear();
      variantsInUse.clear();
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
        let defaultIndex = 0;
        if (typeof rawGroup.defaultVariantId === 'string') {
          const foundIndex = hydratedVariants.findIndex(v => v.id === rawGroup.defaultVariantId);
          if (foundIndex >= 0) {
            activeIndex = foundIndex;
            defaultIndex = foundIndex;
          }
        }
        if (defaultIndex !== activeIndex) {
          defaultIndex = activeIndex;
        }

        const title = typeof rawGroup.title === 'string' && rawGroup.title.trim()
          ? rawGroup.title.trim()
          : (catalogRef[hydratedVariants[0].catalogIndex]?.titles?.en || '').trim();

        const group = {
          groupId,
          title,
          variants: hydratedVariants,
          activeIndex,
          defaultIndex,
          searchTokens: buildGroupSearchTokens(title, hydratedVariants),
          inUse: new Set(),
          availableCount: hydratedVariants.length,
          allVariantsInUse: false,
          activeVariantInUse: false
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

    function buildInUseMap(catalogIndexes = []) {
      variantsInUse.clear();
      if (!Array.isArray(catalogIndexes)) return;
      catalogIndexes.forEach(index => {
        if (typeof index !== 'number') return;
        const variantMeta = catalogIndexToVariant.get(index);
        if (!variantMeta) return;
        const { groupId, variantIndex } = variantMeta;
        if (!groupMap.has(groupId)) return;
        let bucket = variantsInUse.get(groupId);
        if (!bucket) {
          bucket = new Set();
          variantsInUse.set(groupId, bucket);
        }
        bucket.add(variantIndex);
      });
    }

    function updateGroupAvailability() {
      for (const [groupId, group] of groupMap.entries()) {
        const used = variantsInUse.get(groupId) || new Set();
        const totalVariants = group.variants.length;
        const availableIndices = [];
        for (let i = 0; i < totalVariants; i += 1) {
          if (!used.has(i)) availableIndices.push(i);
        }

        group.inUse = new Set(used);
        group.availableCount = availableIndices.length;
        group.allVariantsInUse = availableIndices.length === 0;

        if (group.allVariantsInUse) {
          const fallback = typeof group.defaultIndex === 'number' ? group.defaultIndex : 0;
          group.activeIndex = fallback;
          group.activeVariantInUse = true;
          continue;
        }

        if (availableIndices.includes(group.activeIndex)) {
          group.activeVariantInUse = false;
          continue;
        }

        const preferred = typeof group.defaultIndex === 'number' ? group.defaultIndex : 0;
        if (availableIndices.includes(preferred)) {
          group.activeIndex = preferred;
          group.activeVariantInUse = false;
          continue;
        }

        group.activeIndex = availableIndices[0];
        group.activeVariantInUse = false;
      }
    }

    return {
      load({ catalog = [], variantGroups = [] } = {}) {
        resetState();
        buildTrackIndex(catalog);
        loadGroups(variantGroups);
        buildLibraryEntries();
      },
      syncVariantsInUse(catalogIndexes = []) {
        buildInUseMap(catalogIndexes);
        updateGroupAvailability();
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
        const total = group.variants.length;
        if (group.allVariantsInUse || group.availableCount <= 0) {
          group.activeVariantInUse = true;
          return group;
        }

        const used = group.inUse || new Set();
        let nextIndex = group.activeIndex;
        let attempts = 0;
        do {
          nextIndex = (nextIndex + delta + total) % total;
          attempts += 1;
        } while (used.has(nextIndex) && attempts <= total);

        if (attempts > total) {
          return group;
        }

        group.activeIndex = nextIndex;
        group.activeVariantInUse = false;
        return group;
      },
      setActiveVariant(groupId, variantIndex) {
        const group = groupMap.get(groupId);
        if (!group || !group.variants || !Number.isInteger(variantIndex)) return null;
        const clamped = ((variantIndex % group.variants.length) + group.variants.length) % group.variants.length;
        if (group.inUse?.has(clamped) && group.availableCount > 0) return group;
        group.activeIndex = clamped;
        group.activeVariantInUse = Boolean(group.inUse?.has(clamped));
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
