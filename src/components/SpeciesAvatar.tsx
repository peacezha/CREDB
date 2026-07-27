import React, { useState } from 'react';

// ============================================================
//  SPECIES AVATAR — "Triticum aestivum" → /icon/Triticum_aestivum.png
//  Candidate order: OVERRIDES → Genus_species.png → Genus.png (genus-level
//  fallback, e.g. Drosophila.png). Species without any artwork fall back
//  to a simple 🌿 glyph.
// ============================================================
const OVERRIDES: Record<string, string> = {
  // 'Species name': 'actual_filename.png'
};

const getCandidates = (species: string): string[] => {
  const urls: string[] = [];
  if (OVERRIDES[species]) urls.push(`/icon/${OVERRIDES[species]}`);
  const words = species.trim().split(/\s+/);
  urls.push(`/icon/${words.join('_')}.png`);
  if (words.length > 1) urls.push(`/icon/${words[0]}.png`);
  return urls;
};

/** URLs that already 404'd once — never requested again (module-level dedupe). */
const deadUrls = new Set<string>();

interface SpeciesAvatarProps {
  species: string;
  size: number;
  /** Reserved for callers that want an inner ring around the artwork. */
  ring?: boolean;
}

const SpeciesAvatar: React.FC<SpeciesAvatarProps> = ({ species, size }) => {
  // Re-render trigger only — the candidate index itself is derived each render
  // from the module-level dead-URL set, so remounts never re-request a 404.
  const [, bump] = useState(0);
  const candidates = getCandidates(species);
  let index = candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    if (!deadUrls.has(candidates[i])) {
      index = i;
      break;
    }
  }

  if (index < candidates.length) {
    return (
      <img
        src={candidates[index]}
        alt={species}
        loading="lazy"
        draggable={false}
        style={{ width: size * 0.9, height: size * 0.9, objectFit: 'contain' }}
        onError={() => {
          deadUrls.add(candidates[index]);
          bump(n => n + 1);
        }}
      />
    );
  }

  return (
    <span role="img" aria-label={species} style={{ fontSize: size * 0.5, lineHeight: 1 }}>
      🌿
    </span>
  );
};

export default SpeciesAvatar;
