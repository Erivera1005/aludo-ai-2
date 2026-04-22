export interface Pet {
  id: string;
  name: string;
  animal_type: string;
  breed?: string | null;
  sex?: string | null;
  age?: string | null;
  owner_name?: string | null;
  owner_contact?: string | null;
  allergies?: string | null;
}

const KEY = "aludo:pet";

export const savePet = (pet: Pet) => {
  try { localStorage.setItem(KEY, JSON.stringify(pet)); } catch {}
};

export const loadPet = (): Pet | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Pet) : null;
  } catch { return null; }
};

export const clearPet = () => {
  try { localStorage.removeItem(KEY); } catch {}
};
