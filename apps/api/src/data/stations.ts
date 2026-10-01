/**
 * Approximate station coordinates (WGS84) used to draw routes when a provider does not return
 * coordinates, and by the demo simulator. Values are rounded public locations of station buildings
 * and are accurate to a few hundred metres — good for route drawing, not for surveying.
 */
export interface StationInfo {
  name: string;
  lat: number;
  lng: number;
}

export const STATIONS: Record<string, StationInfo> = {
  // Kerala & coastal Karnataka
  MAQ: { name: 'Mangaluru Central', lat: 12.864, lng: 74.842 },
  KGQ: { name: 'Kasaragod', lat: 12.494, lng: 74.989 },
  KZE: { name: 'Kanhangad', lat: 12.318, lng: 75.089 },
  PAY: { name: 'Payyanur', lat: 12.104, lng: 75.204 },
  CAN: { name: 'Kannur', lat: 11.8745, lng: 75.3704 },
  TLY: { name: 'Thalassery', lat: 11.75, lng: 75.4925 },
  BDJ: { name: 'Vadakara', lat: 11.608, lng: 75.5917 },
  CLT: { name: 'Kozhikode', lat: 11.2467, lng: 75.7806 },
  TIR: { name: 'Tirur', lat: 10.915, lng: 75.9217 },
  KTU: { name: 'Kuttippuram', lat: 10.8433, lng: 76.0333 },
  SRR: { name: 'Shoranur Junction', lat: 10.7614, lng: 76.2717 },
  TCR: { name: 'Thrissur', lat: 10.5153, lng: 76.2108 },
  AWY: { name: 'Aluva', lat: 10.1081, lng: 76.3518 },
  ERN: { name: 'Ernakulam Town', lat: 9.9908, lng: 76.2883 },
  ERS: { name: 'Ernakulam Junction', lat: 9.969, lng: 76.291 },
  SRTL: { name: 'Cherthala', lat: 9.684, lng: 76.336 },
  ALLP: { name: 'Alappuzha', lat: 9.49, lng: 76.326 },
  KTYM: { name: 'Kottayam', lat: 9.5953, lng: 76.533 },
  CGY: { name: 'Changanassery', lat: 9.4447, lng: 76.5469 },
  TRVL: { name: 'Tiruvalla', lat: 9.385, lng: 76.577 },
  CNGR: { name: 'Chengannur', lat: 9.317, lng: 76.615 },
  MVLK: { name: 'Mavelikara', lat: 9.253, lng: 76.553 },
  KYJ: { name: 'Kayamkulam Junction', lat: 9.1757, lng: 76.5106 },
  QLN: { name: 'Kollam Junction', lat: 8.886, lng: 76.595 },
  VAK: { name: 'Varkala Sivagiri', lat: 8.734, lng: 76.726 },
  TVC: { name: 'Thiruvananthapuram Central', lat: 8.4875, lng: 76.9525 },

  // Karnataka, Andhra Pradesh, Telangana
  SBC: { name: 'KSR Bengaluru', lat: 12.9781, lng: 77.5697 },
  YPR: { name: 'Yesvantpur Junction', lat: 13.0237, lng: 77.5507 },
  HUP: { name: 'Hindupur', lat: 13.8282, lng: 77.4966 },
  DMM: { name: 'Dharmavaram Junction', lat: 14.4146, lng: 77.72 },
  ATP: { name: 'Anantapur', lat: 14.6872, lng: 77.596 },
  GTL: { name: 'Guntakal Junction', lat: 15.1731, lng: 77.3698 },
  AD: { name: 'Adoni', lat: 15.629, lng: 77.274 },
  MALM: { name: 'Mantralayam Road', lat: 15.945, lng: 77.428 },
  RC: { name: 'Raichur', lat: 16.2111, lng: 77.3515 },
  YG: { name: 'Yadgir', lat: 16.77, lng: 77.138 },
  WADI: { name: 'Wadi Junction', lat: 17.0563, lng: 76.9918 },
  KLBG: { name: 'Kalaburagi', lat: 17.326, lng: 76.834 },
  KRNT: { name: 'Kurnool City', lat: 15.818, lng: 78.041 },
  KCG: { name: 'Kacheguda', lat: 17.3897, lng: 78.4993 },
  SC: { name: 'Secunderabad Junction', lat: 17.4337, lng: 78.5016 },
  KZJ: { name: 'Kazipet Junction', lat: 17.9757, lng: 79.5124 },
  WL: { name: 'Warangal', lat: 17.9713, lng: 79.6 },
  RDM: { name: 'Ramagundam', lat: 18.775, lng: 79.457 },
  KMT: { name: 'Khammam', lat: 17.247, lng: 80.144 },
  BZA: { name: 'Vijayawada Junction', lat: 16.518, lng: 80.619 },
  OGL: { name: 'Ongole', lat: 15.504, lng: 80.048 },
  NLR: { name: 'Nellore', lat: 14.441, lng: 79.986 },
  GDR: { name: 'Gudur Junction', lat: 14.146, lng: 79.851 },
  MAS: { name: 'MGR Chennai Central', lat: 13.0827, lng: 80.2752 },

  // Maharashtra, Gujarat
  CSMT: { name: 'Mumbai CSMT', lat: 18.9398, lng: 72.8355 },
  DR: { name: 'Dadar', lat: 19.019, lng: 72.843 },
  TNA: { name: 'Thane', lat: 19.186, lng: 72.976 },
  KYN: { name: 'Kalyan Junction', lat: 19.236, lng: 73.13 },
  IGP: { name: 'Igatpuri', lat: 19.695, lng: 73.56 },
  NK: { name: 'Nashik Road', lat: 19.948, lng: 73.842 },
  MMCT: { name: 'Mumbai Central', lat: 18.9696, lng: 72.8196 },
  BVI: { name: 'Borivali', lat: 19.229, lng: 72.857 },
  ST: { name: 'Surat', lat: 21.205, lng: 72.841 },
  BRC: { name: 'Vadodara Junction', lat: 22.3109, lng: 73.181 },
  SUR: { name: 'Solapur', lat: 17.665, lng: 75.8933 },
  DD: { name: 'Daund Junction', lat: 18.4656, lng: 74.5826 },
  ANG: { name: 'Ahilyanagar', lat: 19.0786, lng: 74.7397 },
  MMR: { name: 'Manmad Junction', lat: 20.2522, lng: 74.4382 },
  JL: { name: 'Jalgaon Junction', lat: 21.005, lng: 75.564 },
  BSL: { name: 'Bhusaval Junction', lat: 21.0478, lng: 75.7884 },
  AK: { name: 'Akola Junction', lat: 20.709, lng: 77.003 },
  BD: { name: 'Badnera Junction', lat: 20.853, lng: 77.735 },
  WR: { name: 'Wardha Junction', lat: 20.738, lng: 78.602 },
  NGP: { name: 'Nagpur Junction', lat: 21.152, lng: 79.088 },
  BPQ: { name: 'Balharshah', lat: 19.8502, lng: 79.348 },

  // Madhya Pradesh, Rajasthan, Uttar Pradesh, Delhi
  KNW: { name: 'Khandwa Junction', lat: 21.8264, lng: 76.3524 },
  ET: { name: 'Itarsi Junction', lat: 22.6136, lng: 77.7629 },
  BPL: { name: 'Bhopal Junction', lat: 23.2669, lng: 77.4136 },
  RKMP: { name: 'Rani Kamalapati', lat: 23.2205, lng: 77.4385 },
  BINA: { name: 'Bina Junction', lat: 24.177, lng: 78.201 },
  VGLJ: { name: 'Virangana Lakshmibai Jhansi', lat: 25.4466, lng: 78.5631 },
  GWL: { name: 'Gwalior Junction', lat: 26.2154, lng: 78.1828 },
  AGC: { name: 'Agra Cantt', lat: 27.1588, lng: 77.9898 },
  MTJ: { name: 'Mathura Junction', lat: 27.4799, lng: 77.6737 },
  NDLS: { name: 'New Delhi', lat: 28.643, lng: 77.2194 },
  NZM: { name: 'Hazrat Nizamuddin', lat: 28.5884, lng: 77.2541 },
  RTM: { name: 'Ratlam Junction', lat: 23.342, lng: 75.043 },
  NAD: { name: 'Nagda Junction', lat: 23.456, lng: 75.417 },
  KOTA: { name: 'Kota Junction', lat: 25.2241, lng: 75.877 },
  SWM: { name: 'Sawai Madhopur', lat: 25.998, lng: 76.36 },
  CNB: { name: 'Kanpur Central', lat: 26.454, lng: 80.351 },
  PRYJ: { name: 'Prayagraj Junction', lat: 25.4446, lng: 81.826 },
  DDU: { name: 'Pt. Deen Dayal Upadhyaya Junction', lat: 25.2797, lng: 83.117 },

  // Chhattisgarh, Odisha, Jharkhand, Bihar, West Bengal
  G: { name: 'Gondia Junction', lat: 21.46, lng: 80.195 },
  DURG: { name: 'Durg Junction', lat: 21.19, lng: 81.285 },
  R: { name: 'Raipur Junction', lat: 21.251, lng: 81.631 },
  BSP: { name: 'Bilaspur Junction', lat: 22.08, lng: 82.15 },
  JSG: { name: 'Jharsuguda Junction', lat: 21.853, lng: 84.006 },
  ROU: { name: 'Rourkela', lat: 22.256, lng: 84.854 },
  CKP: { name: 'Chakradharpur', lat: 22.697, lng: 85.628 },
  TATA: { name: 'Tatanagar Junction', lat: 22.771, lng: 86.202 },
  KGP: { name: 'Kharagpur Junction', lat: 22.3396, lng: 87.3204 },
  HWH: { name: 'Howrah Junction', lat: 22.5839, lng: 88.3426 },
  ASN: { name: 'Asansol Junction', lat: 23.6857, lng: 86.986 },
  DHN: { name: 'Dhanbad Junction', lat: 23.7915, lng: 86.429 },
  KQR: { name: 'Koderma Junction', lat: 24.468, lng: 85.593 },
  GAYA: { name: 'Gaya Junction', lat: 24.803, lng: 85.008 },
};

export function lookupStation(code: string): StationInfo | null {
  return STATIONS[code.trim().toUpperCase()] ?? null;
}
