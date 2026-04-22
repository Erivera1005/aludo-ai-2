import { useState, FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Pet } from "@/lib/petStorage";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

interface Props {
  slug: string;
  onCreated: (pet: Pet) => void;
}

const OnboardingForm = ({ slug, onCreated }: Props) => {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    animal_type: "",
    breed: "",
    sex: "",
    age: "",
    owner_name: "",
    owner_contact: "",
    allergies: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !form.name.trim() ||
      !form.animal_type.trim() ||
      !form.breed.trim() ||
      !form.sex ||
      !form.age.trim() ||
      !form.owner_name.trim() ||
      !form.owner_contact.trim()
    ) {
      toast.error("Por favor completa todos los campos (las alergias son opcionales)");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        slug,
        name: form.name.trim(),
        animal_type: form.animal_type.trim(),
        breed: form.breed.trim() || null,
        sex: form.sex || null,
        age: form.age.trim() || null,
        owner_name: form.owner_name.trim() || null,
        owner_contact: form.owner_contact.trim() || null,
        allergies: form.allergies.trim() || null,
      };
      const { data, error } = await supabase
        .from("pets")
        .insert(payload)
        .select()
        .single();
      if (error) {
        // If slug already exists (race condition), reload it
        if (error.code === "23505") {
          const { data: existing } = await supabase
            .from("pets")
            .select("*")
            .ilike("slug", slug)
            .maybeSingle();
          if (existing) {
            onCreated(existing as unknown as Pet);
            return;
          }
        }
        throw error;
      }
      onCreated(data as unknown as Pet);
    } catch (err) {
      console.error(err);
      toast.error("No pudimos guardar tu mascota. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-hero flex flex-col items-center px-5 py-10">
      <img src={logo} alt="Aludo" className="h-14 w-auto mb-8 select-none" draggable={false} />
      <div className="w-full max-w-md animate-fade-in-up">
        <h1 className="text-foreground text-2xl font-semibold text-center mb-2">
          Cuéntame de tu mascota
        </h1>
        <p className="text-foreground/60 text-sm text-center mb-2">
          En segundos podrás hablar con ella
        </p>
        <p className="text-foreground/40 text-xs text-center mb-8">
          Este perfil quedará guardado en <span className="text-foreground/70">/{slug}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nombre *" value={form.name} onChange={set("name")} placeholder="Luna" required />
          <Field label="Tipo de animal *" value={form.animal_type} onChange={set("animal_type")} placeholder="Perro, gato, conejo..." required />
          <Field label="Raza *" value={form.breed} onChange={set("breed")} placeholder="Labrador, mestizo..." required />

          <div>
            <label className="block text-foreground/70 text-xs mb-1.5 ml-1">Sexo *</label>
            <select
              value={form.sex}
              onChange={set("sex")}
              required
              className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent-blue-glow/60 transition-colors"
            >
              <option value="" className="bg-brand-deep">Selecciona</option>
              <option value="macho" className="bg-brand-deep">Macho</option>
              <option value="hembra" className="bg-brand-deep">Hembra</option>
            </select>
          </div>

          <Field label="Edad *" value={form.age} onChange={set("age")} placeholder="2 años" required />
          <Field label="Nombre del dueño *" value={form.owner_name} onChange={set("owner_name")} placeholder="Tu nombre" required />
          <Field label="Contacto del dueño *" value={form.owner_contact} onChange={set("owner_contact")} placeholder="Teléfono" required />
          <Field label="Alergias" value={form.allergies} onChange={set("allergies")} placeholder="Opcional" />

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-4 bg-mic text-white font-semibold py-4 rounded-2xl shadow-mic hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {submitting ? "Preparando..." : "Comenzar"}
          </button>
        </form>
      </div>
    </main>
  );
};

const Field = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  required?: boolean;
}) => (
  <div>
    <label className="block text-foreground/70 text-xs mb-1.5 ml-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent-blue-glow/60 transition-colors"
    />
  </div>
);

export default OnboardingForm;
