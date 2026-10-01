import { haversineKm } from '@railtrack/shared';
import { STATIONS } from './stations.ts';

/**
 * DEMO DATA ONLY. Routes follow real corridors but timetables are generated from an average speed and
 * departure times are chosen so that most demo trains are mid-journey during the day. Times, platforms
 * and delays are simulated — they are not official Indian Railways schedules.
 */

export type MockScenario = 'normal' | 'reported_position' | 'rescheduled' | 'diverted' | 'cancelled';

/** [stationCode, haltMinutes] — haltMinutes 0 means the train passes without stopping. */
type StopDef = readonly [code: string, halt: number];

export interface MockTrainDefinition {
  number: string;
  name: string;
  departure: string; // HH:mm IST from origin
  avgSpeedKmh: number;
  stops: readonly StopDef[];
  scenario: MockScenario;
  /** Max origin delay (minutes) and per-segment delay drift. */
  delay: { origin: number; drift: number };
  rescheduleMinutes?: number;
  /** Station codes skipped because of a diversion. */
  divertedSkips?: readonly string[];
  diversionNote?: string;
}

export const MOCK_TRAINS: readonly MockTrainDefinition[] = [
  {
    number: '12082',
    name: 'Kannur – Thiruvananthapuram Jan Shatabdi Express',
    departure: '04:50',
    avgSpeedKmh: 58,
    scenario: 'normal',
    delay: { origin: 6, drift: 6 },
    stops: [
      ['CAN', 0], ['TLY', 2], ['BDJ', 2], ['CLT', 5], ['TIR', 2], ['KTU', 0], ['SRR', 5], ['TCR', 3], ['AWY', 2],
      ['ERN', 5], ['KTYM', 3], ['CGY', 1], ['TRVL', 1], ['CNGR', 2], ['MVLK', 0], ['KYJ', 2], ['QLN', 3], ['VAK', 1], ['TVC', 0],
    ],
  },
  {
    number: '12627',
    name: 'Karnataka Express',
    departure: '06:40',
    avgSpeedKmh: 55,
    scenario: 'normal',
    delay: { origin: 12, drift: 10 },
    stops: [
      ['SBC', 0], ['YPR', 2], ['HUP', 2], ['DMM', 5], ['ATP', 2], ['GTL', 10], ['AD', 2], ['MALM', 0], ['RC', 2], ['YG', 1],
      ['WADI', 5], ['KLBG', 3], ['SUR', 5], ['DD', 10], ['ANG', 3], ['MMR', 5], ['BSL', 10], ['KNW', 5], ['ET', 10],
      ['BPL', 10], ['BINA', 2], ['VGLJ', 10], ['GWL', 3], ['AGC', 5], ['MTJ', 2], ['NDLS', 0],
    ],
  },
  {
    number: '16348',
    name: 'Mangaluru – Thiruvananthapuram Express',
    departure: '09:15',
    avgSpeedKmh: 48,
    scenario: 'normal',
    delay: { origin: 8, drift: 8 },
    stops: [
      ['MAQ', 0], ['KGQ', 2], ['KZE', 2], ['PAY', 2], ['CAN', 5], ['TLY', 2], ['BDJ', 2], ['CLT', 5], ['TIR', 2], ['KTU', 1],
      ['SRR', 10], ['TCR', 3], ['AWY', 2], ['ERS', 5], ['SRTL', 1], ['ALLP', 3], ['KYJ', 3], ['QLN', 3], ['VAK', 1], ['TVC', 0],
    ],
  },
  {
    number: '12951',
    name: 'Mumbai Central – New Delhi Rajdhani Express',
    departure: '08:00',
    avgSpeedKmh: 88,
    scenario: 'reported_position',
    delay: { origin: 3, drift: 4 },
    stops: [['MMCT', 0], ['BVI', 3], ['ST', 5], ['BRC', 5], ['RTM', 5], ['NAD', 0], ['KOTA', 5], ['SWM', 0], ['MTJ', 0], ['NDLS', 0]],
  },
  {
    number: '12301',
    name: 'Howrah – New Delhi Rajdhani Express',
    departure: '07:30',
    avgSpeedKmh: 82,
    scenario: 'normal',
    delay: { origin: 5, drift: 7 },
    stops: [['HWH', 0], ['ASN', 0], ['DHN', 5], ['KQR', 0], ['GAYA', 3], ['DDU', 10], ['PRYJ', 5], ['CNB', 5], ['NDLS', 0]],
  },
  {
    number: '22691',
    name: 'KSR Bengaluru – Hazrat Nizamuddin Rajdhani Express',
    departure: '10:00',
    avgSpeedKmh: 76,
    scenario: 'rescheduled',
    rescheduleMinutes: 150,
    delay: { origin: 0, drift: 5 },
    stops: [
      ['SBC', 0], ['YPR', 2], ['ATP', 2], ['GTL', 5], ['KRNT', 2], ['KCG', 5], ['KZJ', 0], ['BPQ', 5], ['NGP', 10],
      ['ET', 5], ['BPL', 10], ['VGLJ', 10], ['GWL', 2], ['AGC', 5], ['NZM', 0],
    ],
  },
  {
    number: '12622',
    name: 'Tamil Nadu Express',
    departure: '05:30',
    avgSpeedKmh: 70,
    scenario: 'diverted',
    divertedSkips: ['KZJ', 'WL'],
    diversionNote: 'Diverted between Balharshah (BPQ) and Vijayawada (BZA) via Ramagundam–Khammam; Warangal (WL) and Kazipet (KZJ) not served',
    delay: { origin: 10, drift: 9 },
    stops: [
      ['NDLS', 0], ['MTJ', 0], ['AGC', 5], ['GWL', 3], ['VGLJ', 10], ['BINA', 0], ['BPL', 10], ['ET', 10], ['NGP', 10], ['WR', 0],
      ['BPQ', 5], ['RDM', 0], ['KZJ', 2], ['WL', 2], ['KMT', 0], ['BZA', 15], ['OGL', 0], ['NLR', 2], ['GDR', 0], ['MAS', 0],
    ],
  },
  {
    number: '12859',
    name: 'Gitanjali Express',
    departure: '14:05',
    avgSpeedKmh: 62,
    scenario: 'cancelled',
    delay: { origin: 0, drift: 0 },
    stops: [
      ['HWH', 0], ['KGP', 5], ['TATA', 10], ['CKP', 5], ['ROU', 8], ['JSG', 3], ['BSP', 10], ['R', 5], ['DURG', 5], ['G', 3],
      ['NGP', 5], ['WR', 2], ['BD', 3], ['AK', 3], ['BSL', 10], ['JL', 2], ['MMR', 5], ['NK', 3], ['IGP', 0], ['KYN', 3], ['DR', 2], ['CSMT', 0],
    ],
  },
  {
    number: '12002',
    name: 'New Delhi – Rani Kamalapati Shatabdi Express',
    departure: '11:30',
    avgSpeedKmh: 92,
    scenario: 'normal',
    delay: { origin: 2, drift: 3 },
    stops: [['NDLS', 0], ['MTJ', 2], ['AGC', 5], ['GWL', 3], ['VGLJ', 5], ['BINA', 2], ['BPL', 5], ['RKMP', 0]],
  },
];

/** Demo-only train numbers that simulate provider failures. */
export const MOCK_RATE_LIMITED_TRAIN = '99999';
export const MOCK_UNAVAILABLE_TRAIN = '99998';

/** Real rail routes are longer than straight lines between stations. */
const RAIL_CIRCUITY = 1.18;

export interface MockStopTimetable {
  code: string;
  name: string;
  lat: number;
  lng: number;
  isHalt: boolean;
  haltMinutes: number;
  distanceKm: number;
  /** Minutes after scheduled origin departure. Null at origin (arrival) / destination (departure). */
  arrivalOffset: number | null;
  departureOffset: number | null;
  platform: string | null;
}

const round5 = (n: number) => Math.round(n / 5) * 5;

/** Build a deterministic demo timetable from the route and average speed. */
export function buildMockTimetable(def: MockTrainDefinition): MockStopTimetable[] {
  let distance = 0;
  let clock = 0;
  return def.stops.map(([code, halt], index) => {
    const station = STATIONS[code];
    if (!station) throw new Error(`Mock station ${code} missing from STATIONS`);
    if (index > 0) {
      const [prevCode] = def.stops[index - 1]!;
      const prev = STATIONS[prevCode]!;
      const segmentKm = haversineKm(prev, station) * RAIL_CIRCUITY;
      distance += segmentKm;
      clock += (segmentKm / def.avgSpeedKmh) * 60;
    }
    const isFirst = index === 0;
    const isLast = index === def.stops.length - 1;
    const arrivalOffset = isFirst ? null : round5(clock);
    if (!isFirst) clock = arrivalOffset! + halt;
    const departureOffset = isLast ? null : isFirst ? 0 : arrivalOffset! + halt;
    const isHalt = isFirst || isLast || halt > 0;
    return {
      code,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      isHalt,
      haltMinutes: halt,
      distanceKm: Math.round(distance),
      arrivalOffset,
      departureOffset,
      platform: isHalt ? String(1 + (hashString(def.number + code) % 6)) : null,
    };
  });
}

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32) so a train's simulated day is stable across requests. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function findMockTrain(trainNumber: string): MockTrainDefinition | undefined {
  return MOCK_TRAINS.find((t) => t.number === trainNumber);
}
