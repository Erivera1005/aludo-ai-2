import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { savePet, type Pet } from "@/lib/petStorage";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

const Onboarding = () => {
  const navigate = useNavigate();
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
    if (!form.name.trim() || !form.animal_type.trim() || !form.sex) {
      toast.error("Nombre, tipo de animal y sexo son obligatorios");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
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
      if (error) throw error;
      savePet(data as Pet);
      navigate("/voice", { replace: true });
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
        <p className="text-foreground/60 text-sm text-center mb-8">
          En segundos podrás hablar con ella
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nombre *" value={form.name} onChange={set("name")} placeholder="Luna" />
          <Field label="Tipo de animal *" value={form.animal_type} onChange={set("animal_type")} placeholder="Perro, gato, conejo..." />
          <Field label="Raza" value={form.breed} onChange={set("breed")} placeholder="Opcional" />

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

          <Field label="Edad" value={form.age} onChange={set("age")} placeholder="2 años" />
          <Field label="Nombre del dueño" value={form.owner_name} onChange={set("owner_name")} placeholder="Opcional" />
          <Field label="Contacto del dueño" value={form.owner_contact} onChange={set("owner_contact")} placeholder="Teléfono opcional" />
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
}) => (
  <div>
    <label className="block text-foreground/70 text-xs mb-1.5 ml-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-full bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent-blue-glow/60 transition-colors"
    />
  </div>
);

export default Onboarding;
