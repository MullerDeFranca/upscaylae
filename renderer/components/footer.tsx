import React from "react";

function Footer() {
  return (
    <div className="p-2 text-center text-xs text-base-content/50">
      <p>
        Upscaylae — versão de Muller de França baseada no{" "}
        <a
          className="font-bold"
          href="https://github.com/upscayl/upscayl"
          target="_blank"
        >
          Upscayl
        </a>{" "}
        (AGPL-3.0)
      </p>
      <p>
        Código:{" "}
        <a
          href="https://github.com/MullerDeFranca/upscaylae"
          className="font-bold"
          target="_blank"
        >
          MullerDeFranca/upscaylae
        </a>
      </p>
    </div>
  );
}

export default Footer;
