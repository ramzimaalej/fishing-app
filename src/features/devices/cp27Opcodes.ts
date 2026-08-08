/**
 * Command vocabulary for the DX-CP27-G — the part nobody captured.
 *
 * The FRAMING is confirmed: commands are ASCII, prefixed "NO", written to
 * 0xFFE2 after unlocking 0xFFE3 with the password. What no capture recorded is
 * any individual command's text — including power-off.
 *
 * WHY THIS IS NOT GUESSED. A wrong "NO" command is not a harmless no-op: the
 * same channel configures advertising interval, transmit power, frame slots and
 * the password itself. A tag that stops advertising after a bad write looks
 * exactly like a flat battery, so the mistake is also expensive to diagnose. And
 * there is no factory reset short of the vendor app. The cost of guessing wrong
 * is a bricked tag; the cost of not guessing is one capture session.
 *
 * HOW TO CAPTURE IT (Android, ~5 minutes):
 *
 *   1. Settings → Developer options → Enable Bluetooth HCI snoop log.
 *   2. Toggle Bluetooth off and on, so the log starts clean.
 *   3. In the VENDOR app: connect to the tag and use its power-off / shutdown.
 *   4. Take a bug report (Developer options → Bug report) or pull
 *      /data/misc/bluetooth/logs/btsnoop_hci.log via adb.
 *   5. Open it in Wireshark and filter: btatt.opcode == 0x12
 *      Find the write to handle 0x0021 (0xFFE2). Its ASCII value, minus the
 *      leading "NO", is the opcode.
 *
 * Paste the result into Admin → Device commands and power-off starts working.
 * The same procedure yields every other command the vendor app can send.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface Cp27Opcodes {
  /**
   * Command body for power-down, WITHOUT the "NO" prefix. Null until captured —
   * and null is what makes the power-off button refuse rather than guess.
   */
  powerOff: string | null;
  /** Per-device password, when the factory default has been changed. */
  password: string | null;
}

interface OpcodeState {
  opcodes: Cp27Opcodes;
  setPowerOff: (value: string | null) => void;
  setPassword: (value: string | null) => void;
}

export const useCp27OpcodeStore = create<OpcodeState>()(
  persist(
    (set) => ({
      opcodes: { powerOff: null, password: null },
      setPowerOff: (value) =>
        set((s) => ({ opcodes: { ...s.opcodes, powerOff: value?.trim() || null } })),
      setPassword: (value) =>
        set((s) => ({ opcodes: { ...s.opcodes, password: value?.trim() || null } })),
    }),
    {
      name: 'castmate:cp27-opcodes',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ opcodes: s.opcodes }),
    },
  ),
);

export function currentOpcodes(): Cp27Opcodes {
  return useCp27OpcodeStore.getState().opcodes;
}
