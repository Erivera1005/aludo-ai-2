import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";

const Home = () => {
  const navigate = useNavigate();
  const [slug, setSlug] = useState("");

  const go = (e: FormEvent) => {
    e.preventDefault();
    const s = slug.trim().replace(/^\/+/, "");
    if (!s) return;
    navigate(`/${s}`);
  };

  return (
    <main className="min-h-screen bg-hero flex flex-col items-center justify-center px-5 py-10">
      <img src={logo} alt="Aludo" className="w-56 max-w-[70vw] h-auto mb-10 select-none" draggable={false} />
      <p className="text-foreground/70 text-center text-sm mb-6 max-w-xs">
        Cada link es una mascota. Elige el tuyo.
      </p>
      <form onSubmit={go} className="w-full max-w-sm flex gap-2">
        <span className="flex items-center text-foreground/50 px-2">/</span>
        <input
          autoFocus
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="luna"
          className="flex-1 bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-3 text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent-blue-glow/60 transition-colors"
        />
        <button
          type="submit"
          className="bg-mic text-white font-semibold px-5 rounded-xl shadow-mic active:scale-[0.98] transition-all"
        >
          Ir
        </button>
      </form>
    </main>
  );
};

export default Home;
