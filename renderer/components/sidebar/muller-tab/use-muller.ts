import { useEffect, useRef } from "react";
import { MULLER, EventoMuller } from "@common/muller-commands";
import { EstadoDownload, ProgressoMuller } from "@common/muller-types";

/**
 * O preload não tem "off" para remover ouvintes, então cada canal é registrado
 * uma única vez e repassado para quem estiver ouvindo no momento.
 */
type Ouvinte<T> = (dado: T) => void;
const ouvintes = {
  progresso: new Set<Ouvinte<ProgressoMuller>>(),
  evento: new Set<Ouvinte<EventoMuller>>(),
  download: new Set<Ouvinte<EstadoDownload>>(),
};
let registrado = false;

function registrar() {
  if (registrado || typeof window === "undefined" || !window.electron) return;
  registrado = true;
  window.electron.on(MULLER.PROGRESSO, (_: unknown, d: ProgressoMuller) =>
    ouvintes.progresso.forEach((f) => f(d)),
  );
  window.electron.on(MULLER.EVENTO, (_: unknown, d: EventoMuller) =>
    ouvintes.evento.forEach((f) => f(d)),
  );
  window.electron.on(MULLER.DOWNLOAD, (_: unknown, d: EstadoDownload) =>
    ouvintes.download.forEach((f) => f(d)),
  );
}

export function useOuvirMuller<K extends keyof typeof ouvintes>(
  canal: K,
  fn: (dado: any) => void,
) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    registrar();
    const ouvinte = (d: any) => ref.current(d);
    (ouvintes[canal] as Set<Ouvinte<any>>).add(ouvinte);
    return () => {
      (ouvintes[canal] as Set<Ouvinte<any>>).delete(ouvinte);
    };
  }, [canal]);
}

export const invocar = <T = any>(canal: string, dado?: any): Promise<T> =>
  window.electron.invoke(canal, dado);
