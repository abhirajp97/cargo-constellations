# AISHub receiver path

A coastal AIS receiver is a small VHF radio listening station. It does not transmit to ships. An antenna, mounted outdoors with a clear view toward navigable water, hears the public AIS broadcasts already used by nearby vessels. A receiver or software decoder turns those radio bursts into NMEA messages and forwards them over the internet.

## What a useful station needs

- A location near a harbor, shipping channel, river mouth, or busy coastline. Antenna height and an unobstructed horizon matter more than proximity to the water alone.
- A marine-band AIS antenna near 162 MHz, weatherproof coaxial cable, lightning/static protection appropriate to the site, and a grounded installation.
- A dual-channel AIS receiver, or a software-defined radio with AIS decoding software.
- A small always-on computer such as a Raspberry Pi when the receiver does not forward NMEA itself.
- Stable power and internet. The data volume is small, but continuity matters.

Typical terrestrial range is roughly 20–40 nautical miles, sometimes more from a high antenna. Buildings, hills, cable loss, antenna height, and local radio noise can reduce it considerably.

## A practical budget

| Component | Low-cost SDR station | Dedicated dual-channel station |
|---|---:|---:|
| Receiver | $35–80 | $150–350 |
| Antenna and mount | $50–150 | $80–200 |
| Coax, adapters, weatherproofing, protection | $40–150 | $50–180 |
| Small computer and power supply | $70–140 | $0–140 |
| Expected total before professional installation | **$195–520** | **$280–870** |

Professional roof or mast work can exceed the hardware cost. Do not improvise a roof, mast, grounding, or lightning installation; use the building owner and a qualified installer where appropriate.

## AISHub qualification

AISHub currently requires a contributor to send a real raw NMEA feed covering at least 10 vessels on average over seven days, maintain at least 90% uptime, downsample no more than once per 60 seconds, and add no more than 10 seconds of delay. Public or scraped feeds cannot be re-contributed. Once qualified, the contributor receives access to the aggregated AISHub API, which should not be polled more than once per minute.

Before buying hardware, confirm all three of these:

1. We have a lawful, long-term antenna location with a clear view of water and reliable internet.
2. AISHub confirms that Cargo Constellations may display transformed positions publicly, with the intended attribution and retention policy.
3. Nearby traffic is likely to exceed the ten-vessel qualification threshold. A week-long SDR survey is the cheapest way to test this.

## Recommendation

Operate a station if there is an interesting coastal location we can control for at least a year. It is a worthwhile civic data contribution and may unlock a broad terrestrial feed at low recurring cost. Do not buy equipment merely to place an indoor antenna far from navigable water; it is unlikely to qualify. Start with a temporary SDR survey, then move to a dedicated dual-channel receiver only after the site proves useful.
