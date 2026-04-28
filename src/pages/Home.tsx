import logo from "@/assets/logo.png";

const Home = () => {
  return (
    <main className="min-h-screen bg-hero flex flex-col items-center justify-center px-5 py-10">
      <img
        src={logo}
        alt="Aludo"
        className="w-64 max-w-[75vw] h-auto mb-10 select-none"
        draggable={false}
      />
      <a
        href="https://tiendaaludo.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="bg-mic text-white font-semibold px-8 py-3 rounded-xl shadow-mic active:scale-[0.98] transition-all"
      >
        Ir a la tienda
      </a>
    </main>
  );
};

export default Home;
