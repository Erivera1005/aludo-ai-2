import logo from "@/assets/logo.png";

interface Props {
  variant: "daily" | "monthly" | "expired";
}

const WHATSAPP = "+573128642686";

const UsageBlocked = ({ variant }: Props) => {
  const isExpired = variant === "expired";
  const title =
    variant === "daily"
      ? "Has alcanzado el límite de hoy"
      : variant === "monthly"
      ? "Has alcanzado el límite del mes"
      : "Tu collar ha expirado";

  const message =
    variant === "daily"
      ? "Vuelve mañana para seguir hablando con tu mascota."
      : variant === "monthly"
      ? "Tu ciclo mensual de uso terminó. Volverá a estar disponible próximamente."
      : "Han pasado 4 meses desde el primer uso. Para renovarlo, escríbenos por WhatsApp.";

  const waUrl = `https://wa.me/${WHATSAPP.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
    "Hola, quiero renovar mi collar Aludo."
  )}`;

  return (
    <main className="min-h-screen bg-hero flex flex-col items-center justify-center px-6 py-10 text-center">
      <img src={logo} alt="Aludo" className="w-40 h-auto mb-8 opacity-90 select-none" draggable={false} />
      <h1 className="text-foreground text-2xl font-semibold mb-3 max-w-xs">{title}</h1>
      <p className="text-foreground/60 text-sm max-w-xs mb-8">{message}</p>
      {isExpired && (
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-mic text-white font-semibold px-6 py-3 rounded-2xl shadow-mic active:scale-[0.98] transition-all"
        >
          Contactar por WhatsApp
        </a>
      )}
    </main>
  );
};

export default UsageBlocked;
