type SoundName = 'auftrag' | 'angenommen' | 'abgebrochen' | 'status' | 'nachricht';

const DATEIEN: Record<SoundName, any> = {
  auftrag:     require('../assets/sounds/auftrag.wav'),
  angenommen:  require('../assets/sounds/angenommen.wav'),
  abgebrochen: require('../assets/sounds/abgebrochen.wav'),
  status:      require('../assets/sounds/status.wav'),
  nachricht:   require('../assets/sounds/nachricht.wav'),
};

let auftragPlayer: any = null;

async function spiele(name: SoundName) {
  try {
    const { createAudioPlayer } = await import('expo-audio');
    const player = createAudioPlayer(DATEIEN[name]);
    player.play();
    setTimeout(() => { try { player.remove(); } catch (_) {} }, 10000);
  } catch (_) {}
}

async function spieleAuftrag() {
  try {
    const { createAudioPlayer } = await import('expo-audio');
    if (auftragPlayer) {
      try { auftragPlayer.pause(); auftragPlayer.remove(); } catch (_) {}
      auftragPlayer = null;
    }
    const player = createAudioPlayer(DATEIEN['auftrag']);
    player.loop = true;
    player.volume = 0.4;
    player.play();
    auftragPlayer = player;
    setTimeout(() => {
      if (auftragPlayer === player) {
        try { player.pause(); player.remove(); } catch (_) {}
        auftragPlayer = null;
      }
    }, 5000);
  } catch (_) {}
}

function stopAuftrag() {
  if (auftragPlayer) {
    try { auftragPlayer.pause(); auftragPlayer.remove(); } catch (_) {}
    auftragPlayer = null;
  }
}

export const spieleTon = {
  neuerAuftrag:     () => spieleAuftrag().catch(() => {}),
  stopAuftrag:      () => stopAuftrag(),
  fahrtAngenommen:  () => { stopAuftrag(); spiele('angenommen').catch(() => {}); },
  fahrtAbgebrochen: () => { stopAuftrag(); spiele('abgebrochen').catch(() => {}); },
  statusUpdate:     () => spiele('status').catch(() => {}),
  nachricht:        () => spiele('nachricht').catch(() => {}),
};
