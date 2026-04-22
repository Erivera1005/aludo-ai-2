export interface Pet {
  id: string;
  slug: string;
  name: string;
  animal_type: string;
  breed?: string | null;
  sex?: string | null;
  age?: string | null;
  owner_name?: string | null;
  owner_contact?: string | null;
  allergies?: string | null;
}

const keyFor = (slug: string) => `aludo:pet:${slug.toLowerCase()}`;

export const savePet = (pet: Pet) => {
  try { localStorage.setItem(keyFor(pet.slug), JSON.stringify(pet)); } catch {}
};

export const loadPet = (slug: string): Pet | null => {
  try {
    const raw = localStorage.getItem(keyFor(slug));
    return raw ? (JSON.parse(raw) as Pet) : null;
  } catch { return null; }
};

export const clearPet = (slug: string) => {
  try { localStorage.removeItem(keyFor(slug)); } catch {}
};
