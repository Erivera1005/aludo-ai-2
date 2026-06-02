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