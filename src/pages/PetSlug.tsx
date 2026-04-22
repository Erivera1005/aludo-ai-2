import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { loadPet, savePet, type Pet } from "@/lib/petStorage";
import OnboardingForm from "@/components/OnboardingForm";
import VoiceChat from "@/components/VoiceChat";
import UsageBlocked from "@/components/UsageBlocked";
import logo from "@/assets/logo.png";

type State = "loading" | "create" | "ready";
type Block = "daily" | "monthly" | "expired" | null;

const PetSlug = () => {
  const { slug = "" } = useParams();
  const normalizedSlug = slug.trim();
  const [state, setState] = useState<State>("loading");
  const [pet, setPet] = useState<Pet | null>(null);
  const [block, setBlock] = useState<Block>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!normalizedSlug) return;
      const cached = loadPet(normalizedSlug);
      if (cached) {
        setPet(cached);
        setState("ready");
      }
      const { data, error } = await supabase
        .from("pets")
        .select("*")
        .ilike("slug", normalizedSlug)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        if (!cached) setState("create");
        return;
      }
      if (data) {
        const p = data as unknown as Pet;
        savePet(p);
        setPet(p);
        setState("ready");
      } else if (!cached) {
        setState("create");
      }
    };
    run();
    return () => { cancelled = true; };
  }, [normalizedSlug]);

  const handleCreated = (p: Pet) => {
    savePet(p);
    setPet(p);
    setState("ready");
  };

  if (state === "loading") {
    return (
      <main className="min-h-screen bg-hero flex items-center justify-center">
        <img src={logo} alt="Aludo" className="w-40 h-auto opacity-70 animate-soft-pulse" />
      </main>
    );
  }

  if (block) return <UsageBlocked variant={block} />;

  if (state === "create") {
    return <OnboardingForm slug={normalizedSlug} onCreated={handleCreated} />;
  }

  return <VoiceChat pet={pet!} slug={normalizedSlug} onBlocked={setBlock} />;
};

export default PetSlug;
