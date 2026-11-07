import type { Category, Nature, Need } from './types';

// Categorie iniziali dal documento di progetto. Gli id sono stabili (slug) così backup e regole restano coerenti.
// Ogni sottocategoria eredita natura (fissa/variabile/occasionale) e necessità della macro, salvo eccezioni.

type Sub = [name: string, nature?: Nature, need?: Need];
interface Macro {
  id: string;
  name: string;
  icon: string;
  nature: Nature;
  need: Need;
  subs: Sub[];
}

const EXPENSE: Macro[] = [
  {
    id: 'casa', name: 'Casa e utenze', icon: 'home', nature: 'fixed', need: 'necessary',
    subs: [['Affitto o mutuo'], ['Condominio'], ['Elettricità', 'variable'], ['Gas', 'variable'], ['Acqua', 'variable'], ['Internet e Wi-Fi'], ['Telefonia mobile'], ['Manutenzione domestica', 'occasional'], ['Assicurazione casa']]
  },
  {
    id: 'alimentazione', name: 'Alimentazione', icon: 'food', nature: 'variable', need: 'necessary',
    subs: [['Spesa alimentare'], ['Supermercato'], ['Ristoranti', undefined, 'discretionary'], ['Bar e caffetterie', undefined, 'discretionary'], ['Delivery e cibo da asporto', undefined, 'discretionary']]
  },
  {
    id: 'trasporti', name: 'Trasporti e mobilità', icon: 'car', nature: 'variable', need: 'necessary',
    subs: [['Carburante'], ['Trasporto pubblico'], ['Taxi', undefined, 'discretionary'], ['Car sharing', undefined, 'discretionary'], ['Parcheggi'], ['Pedaggi autostradali'], ['Manutenzione automobile', 'occasional'], ['Assicurazione auto', 'fixed'], ['Bollo auto', 'fixed'], ['Rate del veicolo', 'fixed']]
  },
  {
    id: 'salute', name: 'Salute e benessere', icon: 'health', nature: 'variable', need: 'necessary',
    subs: [['Farmacia'], ['Visite mediche'], ['Esami diagnostici'], ['Assicurazione sanitaria', 'fixed'], ['Palestra', 'fixed', 'discretionary'], ['Attività sportive', undefined, 'discretionary'], ['Benessere personale', undefined, 'discretionary']]
  },
  {
    id: 'abbonamenti', name: 'Abbonamenti e servizi digitali', icon: 'repeat', nature: 'fixed', need: 'discretionary',
    subs: [['Netflix'], ['Spotify'], ['Amazon Prime'], ['iCloud'], ['Apple Music'], ['Software e applicazioni'], ['Altri abbonamenti ricorrenti']]
  },
  {
    id: 'shopping', name: 'Shopping e acquisti personali', icon: 'bag', nature: 'variable', need: 'discretionary',
    subs: [['Abbigliamento'], ['Calzature'], ['Elettronica', 'occasional'], ['Accessori'], ['Cura personale', undefined, 'necessary'], ['Acquisti online']]
  },
  {
    id: 'tempolibero', name: 'Tempo libero e intrattenimento', icon: 'ticket', nature: 'variable', need: 'discretionary',
    subs: [['Cinema'], ['Concerti'], ['Eventi'], ['Viaggi', 'occasional'], ['Vacanze', 'occasional'], ['Hobby'], ['Attività ricreative']]
  },
  {
    id: 'famiglia', name: 'Famiglia e relazioni', icon: 'people', nature: 'variable', need: 'necessary',
    subs: [['Spese per figli'], ['Animali domestici'], ['Regali', 'occasional', 'discretionary'], ['Spese familiari'], ['Assistenza e cura', 'fixed']]
  },
  {
    id: 'finanziamenti', name: 'Finanziamenti e obblighi finanziari', icon: 'bank', nature: 'fixed', need: 'necessary',
    subs: [['Rate di prestiti'], ['Rate di finanziamenti'], ['Interessi passivi', 'variable'], ['Commissioni bancarie', 'variable'], ['Tasse', 'occasional'], ['Imposte', 'occasional'], ['Spese amministrative', 'occasional']]
  },
  {
    id: 'altro', name: 'Altre spese', icon: 'dots', nature: 'occasional', need: 'discretionary',
    subs: [['Spese impreviste', undefined, 'necessary'], ['Spese occasionali']]
  }
];

const INCOME: [id: string, name: string, nature: Nature, icon: string][] = [
  ['stipendio', 'Stipendio', 'fixed', 'briefcase'],
  ['bonus', 'Bonus e premi aziendali', 'occasional', 'star'],
  ['freelance', 'Attività secondarie e freelance', 'variable', 'laptop'],
  ['consulenze', 'Consulenze', 'variable', 'person'],
  ['rendite', 'Rendite passive', 'fixed', 'repeat'],
  ['affitti', 'Affitti percepiti', 'fixed', 'home'],
  ['interessi', 'Interessi bancari', 'fixed', 'bank'],
  ['dividendi', 'Dividendi', 'variable', 'trend'],
  ['plusvalenze', 'Plusvalenze', 'occasional', 'trend'],
  ['rimborsi', 'Rimborsi', 'occasional', 'undo'],
  ['regali-entrate', 'Regali e altre entrate occasionali', 'occasional', 'gift'],
  ['altre-entrate', 'Altre entrate', 'occasional', 'dots']
];

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function defaultCategories(): Category[] {
  const out: Category[] = [];
  EXPENSE.forEach((m, i) => {
    out.push({ id: `exp-${m.id}`, name: m.name, kind: 'expense', parentId: null, icon: m.icon, nature: m.nature, need: m.need, order: i });
    m.subs.forEach(([name, nature, need], j) => {
      out.push({
        id: `exp-${m.id}-${slug(name)}`,
        name,
        kind: 'expense',
        parentId: `exp-${m.id}`,
        icon: m.icon,
        nature: nature ?? m.nature,
        need: need ?? m.need,
        order: j
      });
    });
  });
  INCOME.forEach(([id, name, nature, icon], i) => {
    out.push({ id: `inc-${id}`, name, kind: 'income', parentId: null, icon, nature, need: 'necessary', order: i });
  });
  return out;
}
