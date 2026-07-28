// ============================================================
//  Phylogenetic grouping for the species atlas graph.
//  Hand-curated clade paths: [class, family, genus] — orders are
//  noted in comments but omitted from the path to keep the tree
//  shallow enough for a readable radial layout.
// ============================================================

export interface TreeNode {
  name: string;
  children?: TreeNode[];
  /** Set only on leaf nodes. */
  species?: string;
}

/** species → clade path ([Monocots|Eudicots, family, genus]). */
export const CLADES: Record<string, string[]> = {
  // ── Monocots ──────────────────────────────────────────────
  // Poaceae
  'Triticum aestivum': ['Monocots', 'Poaceae', 'Triticum'],
  'Oryza sativa': ['Monocots', 'Poaceae', 'Oryza'],
  'Zea mays': ['Monocots', 'Poaceae', 'Zea'],
  'Sorghum bicolor': ['Monocots', 'Poaceae', 'Sorghum'],
  'Setaria italica': ['Monocots', 'Poaceae', 'Setaria'],
  'Setaria viridis': ['Monocots', 'Poaceae', 'Setaria'],
  'Brachypodium distachyon': ['Monocots', 'Poaceae', 'Brachypodium'],
  'Hordeum vulgare': ['Monocots', 'Poaceae', 'Hordeum'],
  // Asparagaceae
  'Asparagus officinalis': ['Monocots', 'Asparagaceae', 'Asparagus'],

  // ── Eudicots ──────────────────────────────────────────────
  // Brassicales
  'Arabidopsis thaliana': ['Eudicots', 'Brassicaceae', 'Arabidopsis'],
  'Eutrema salsugineum': ['Eudicots', 'Brassicaceae', 'Eutrema'],
  'Carica papaya': ['Eudicots', 'Caricaceae', 'Carica'],
  // Fabales
  'Glycine max': ['Eudicots', 'Fabaceae', 'Glycine'],
  'Arachis hypogaea': ['Eudicots', 'Fabaceae', 'Arachis'],
  'Phaseolus vulgaris': ['Eudicots', 'Fabaceae', 'Phaseolus'],
  // Cucurbitales
  'Citrullus lanatus': ['Eudicots', 'Cucurbitaceae', 'Citrullus'],
  'Cucumis melo': ['Eudicots', 'Cucurbitaceae', 'Cucumis'],
  'Cucumis sativus': ['Eudicots', 'Cucurbitaceae', 'Cucumis'],
  'Cucurbita maxima': ['Eudicots', 'Cucurbitaceae', 'Cucurbita'],
  'Lagenaria siceraria': ['Eudicots', 'Cucurbitaceae', 'Lagenaria'],
  'Benincasa hispida': ['Eudicots', 'Cucurbitaceae', 'Benincasa'],
  // Rosales
  'Malus domestica': ['Eudicots', 'Rosaceae', 'Malus'],
  'Prunus persica': ['Eudicots', 'Rosaceae', 'Prunus'],
  'Pyrus x bretschneideri': ['Eudicots', 'Rosaceae', 'Pyrus'],
  'Fragaria vesca': ['Eudicots', 'Rosaceae', 'Fragaria'],
  // Malvales
  'Gossypium arboreum': ['Eudicots', 'Malvaceae', 'Gossypium'],
  'Gossypium barbadense': ['Eudicots', 'Malvaceae', 'Gossypium'],
  'Gossypium hirsutum': ['Eudicots', 'Malvaceae', 'Gossypium'],
  'Gossypium raimondii': ['Eudicots', 'Malvaceae', 'Gossypium'],
  // Malpighiales
  'Populus trichocarpa': ['Eudicots', 'Salicaceae', 'Populus'],
  // Myrtales
  'Eucalyptus grandis': ['Eudicots', 'Myrtaceae', 'Eucalyptus'],
  // Vitales
  'Vitis vinifera': ['Eudicots', 'Vitaceae', 'Vitis'],
  // Solanales
  'Solanum lycopersicum': ['Eudicots', 'Solanaceae', 'Solanum'],
  'Solanum pennellii': ['Eudicots', 'Solanaceae', 'Solanum'],
};

/** Family-level colors, tuned to the navy / burgundy / journal palette. */
const FAMILY_COLORS: Record<string, string> = {
  Poaceae: '#3d72aa', // navy-500
  Asparagaceae: '#90b2d8', // navy-300
  Brassicaceae: '#2f5d50', // deep leaf green
  Caricaceae: '#7fb069', // leaf green
  Fabaceae: '#8b7e6a', // journal-500
  Cucurbitaceae: '#d64b6d', // burgundy-500
  Rosaceae: '#bf2f56', // burgundy-600
  Malvaceae: '#e67590', // burgundy-400
  Salicaceae: '#264874', // navy-700
  Myrtaceae: '#5f5547', // journal-700
  Vitaceae: '#8b1a2b', // burgundy-700
  Solanaceae: '#5e8fc5', // navy-400
};

const CLASS_COLORS: Record<string, string> = {
  Monocots: '#3d72aa',
  Eudicots: '#8b1a2b',
  Others: '#9c917d', // journal-400
};

/** Color for a clade name (family-level preferred, muted fallbacks otherwise). */
export const cladeColor = (cladeName: string): string =>
  FAMILY_COLORS[cladeName] ?? CLASS_COLORS[cladeName] ?? '#b8b0a0'; // journal-300

/** Clade path for a species; unknown species land on an "Others" branch. */
export const cladePathFor = (species: string): string[] => {
  const known = CLADES[species];
  if (known) return known;
  const genus = species.trim().split(/\s+/)[0] || species;
  return ['Others', genus];
};

/** Build the nested Plantae tree from the species that actually exist. */
export const buildTree = (speciesList: string[]): TreeNode => {
  const root: TreeNode = { name: 'Plantae', children: [] };
  for (const species of speciesList) {
    let node = root;
    for (const step of cladePathFor(species)) {
      let child = node.children!.find(c => c.name === step && !c.species);
      if (!child) {
        child = { name: step, children: [] };
        node.children!.push(child);
      }
      node = child;
    }
    node.children!.push({ name: species, species });
  }
  return root;
};
