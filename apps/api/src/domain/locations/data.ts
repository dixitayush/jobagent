/**
 * Seed data for the normalized location hierarchy (Country → State → City) plus
 * remote pseudo-locations. Loaded into the `locations` table by the seeder.
 */
export interface CitySeed {
  name: string;
  aliases?: string[];
}
export interface StateSeed {
  name: string;
  aliases?: string[];
  cities: (string | CitySeed)[];
}
export interface CountrySeed {
  name: string;
  code: string;
  aliases: string[];
  states: StateSeed[];
}

export const LOCATION_SEED: CountrySeed[] = [
  {
    name: "India",
    code: "IN",
    aliases: ["ind", "bharat"],
    states: [
      { name: "Uttar Pradesh", aliases: ["up"], cities: ["Noida", { name: "Greater Noida" }, "Lucknow", { name: "Prayagraj", aliases: ["allahabad"] }, "Ghaziabad", "Kanpur", "Varanasi"] },
      { name: "Delhi", aliases: ["nct of delhi", "delhi ncr", "ncr"], cities: [{ name: "Delhi", aliases: ["new delhi", "delhi ncr", "ncr"] }] },
      { name: "Haryana", cities: [{ name: "Gurugram", aliases: ["gurgaon"] }, "Faridabad", "Panchkula"] },
      { name: "Karnataka", cities: [{ name: "Bengaluru", aliases: ["bangalore", "blr", "bengaluru urban"] }, "Mysuru", "Mangaluru", "Hubli"] },
      { name: "Maharashtra", cities: [{ name: "Mumbai", aliases: ["bombay", "navi mumbai", "thane"] }, "Pune", "Nagpur", "Nashik"] },
      { name: "Telangana", cities: [{ name: "Hyderabad", aliases: ["secunderabad", "hyd"] }] },
      { name: "Tamil Nadu", aliases: ["tn"], cities: [{ name: "Chennai", aliases: ["madras"] }, "Coimbatore", "Madurai"] },
      { name: "West Bengal", cities: [{ name: "Kolkata", aliases: ["calcutta"] }] },
      { name: "Gujarat", cities: ["Ahmedabad", { name: "Gandhinagar", aliases: ["gift city"] }, "Surat", "Vadodara"] },
      { name: "Rajasthan", cities: ["Jaipur", "Udaipur", "Jodhpur"] },
      { name: "Kerala", cities: [{ name: "Kochi", aliases: ["cochin", "kochi"] }, { name: "Thiruvananthapuram", aliases: ["trivandrum"] }] },
      { name: "Madhya Pradesh", aliases: ["mp"], cities: ["Indore", "Bhopal"] },
      { name: "Punjab", cities: ["Mohali", "Ludhiana", "Amritsar"] },
      { name: "Chandigarh", cities: ["Chandigarh"] },
      { name: "Odisha", cities: ["Bhubaneswar"] },
      { name: "Andhra Pradesh", aliases: ["ap"], cities: ["Visakhapatnam", "Vijayawada"] },
      { name: "Bihar", cities: ["Patna"] },
      { name: "Goa", cities: ["Panaji"] },
    ],
  },
  {
    name: "United States",
    code: "US",
    aliases: ["usa", "us", "united states of america", "u.s.", "u.s.a."],
    states: [
      { name: "California", aliases: ["ca"], cities: [{ name: "San Francisco", aliases: ["sf", "san francisco bay area", "bay area"] }, "San Jose", "Mountain View", "Palo Alto", "Sunnyvale", "Menlo Park", "Los Angeles", "San Diego", "Santa Clara", "Cupertino"] },
      { name: "Washington", aliases: ["wa"], cities: ["Seattle", "Redmond", "Bellevue"] },
      { name: "New York", aliases: ["ny"], cities: [{ name: "New York City", aliases: ["new york", "nyc", "brooklyn", "manhattan"] }] },
      { name: "Texas", aliases: ["tx"], cities: ["Austin", "Dallas", "Houston"] },
      { name: "Massachusetts", aliases: ["ma"], cities: ["Boston", "Cambridge"] },
      { name: "Illinois", aliases: ["il"], cities: ["Chicago"] },
      { name: "Colorado", aliases: ["co"], cities: ["Denver", "Boulder"] },
      { name: "Georgia", aliases: ["ga"], cities: ["Atlanta"] },
      { name: "Virginia", aliases: ["va"], cities: ["Arlington", "Reston"] },
      { name: "North Carolina", aliases: ["nc"], cities: ["Raleigh", "Charlotte"] },
    ],
  },
  {
    name: "United Kingdom",
    code: "GB",
    aliases: ["uk", "u.k.", "great britain", "england", "gb"],
    states: [
      { name: "England", cities: ["London", "Manchester", "Cambridge", "Birmingham"] },
      { name: "Scotland", cities: ["Edinburgh", "Glasgow"] },
    ],
  },
  { name: "Canada", code: "CA", aliases: ["can"], states: [{ name: "Ontario", aliases: ["on"], cities: ["Toronto", "Ottawa", "Waterloo"] }, { name: "British Columbia", aliases: ["bc"], cities: ["Vancouver"] }, { name: "Quebec", aliases: ["qc"], cities: ["Montreal"] }] },
  { name: "Germany", code: "DE", aliases: ["deutschland"], states: [{ name: "Berlin", cities: ["Berlin"] }, { name: "Bavaria", aliases: ["bayern"], cities: [{ name: "Munich", aliases: ["münchen", "muenchen"] }] }, { name: "Hamburg", cities: ["Hamburg"] }] },
  { name: "Netherlands", code: "NL", aliases: ["holland", "the netherlands"], states: [{ name: "North Holland", cities: ["Amsterdam"] }] },
  { name: "Ireland", code: "IE", aliases: [], states: [{ name: "Leinster", cities: ["Dublin"] }] },
  { name: "Singapore", code: "SG", aliases: ["sg"], states: [{ name: "Singapore", cities: ["Singapore"] }] },
  { name: "United Arab Emirates", code: "AE", aliases: ["uae"], states: [{ name: "Dubai", cities: ["Dubai"] }, { name: "Abu Dhabi", cities: ["Abu Dhabi"] }] },
  { name: "Australia", code: "AU", aliases: ["aus"], states: [{ name: "New South Wales", aliases: ["nsw"], cities: ["Sydney"] }, { name: "Victoria", aliases: ["vic"], cities: ["Melbourne"] }] },
];

/** Remote pseudo-locations: one per country + worldwide. */
export const REMOTE_SEED: { name: string; countryCode: string | null }[] = [
  { name: "Remote - Worldwide", countryCode: null },
  ...LOCATION_SEED.map((c) => ({ name: `Remote - ${c.name}`, countryCode: c.code })),
];
