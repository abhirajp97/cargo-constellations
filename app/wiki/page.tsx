import { DATA_LAYERS } from "../../lib/layers";
import Link from "next/link";

const principles = [
  ["Wonder before analysis", "The first job is to make the recent memory of ocean trade feel worth lingering over. The second is to help explain it."],
  ["Truth before spectacle", "A received position, a model estimate, and a demonstration value must never masquerade as the same kind of fact."],
  ["Time is part of truth", "The primary voyage view is delayed by about four days and assembled from named ocean corridors. Optional live regional radio must never look like global coverage."],
  ["Quiet tools", "Prices and operational signals live beside the globe. They should add meaning without turning the world into a trading terminal."],
];

const glossary = [
  ["AIS", "Automatic Identification System: short radio messages ships transmit for collision avoidance. Tracking is a useful side effect."],
  ["MMSI", "A nine-digit radio identity. It usually identifies a vessel during a live session and also hints at its flag state."],
  ["Draught", "How deeply a ship sits in the water. A deeper draught can suggest a heavier load, but the crew enters this value manually."],
  ["Dead reckoning", "A brief, capped estimate of where a moving vessel is between received radio messages, based on its last speed and course."],
  ["SAR", "Synthetic Aperture Radar. A satellite radar can see a ship-shaped object through cloud and darkness even when no AIS message is present."],
  ["Significant wave height", "The average height of the highest third of waves. It is a practical description of sea state, not the height of every wave."],
  ["Benchmark", "A shared reference price used to understand a market. The public monthly prices here are context, not executable futures quotes."],
  ["Chokepoint", "A narrow passage—such as a canal or strait—through which a large share of trade must pass."],
  ["Listening waters", "The geographic reach of the receiver networks currently feeding this world. It is coverage, not a claim that every ship inside it will be heard."],
  ["Inferred voyage", "A pale interpretive path from the last received position toward a confidently resolved AIS destination. It is not a filed route or navigation advice."],
  ["Delayed voyage", "A gold path joining hourly gridded AIS observations that retain the same vessel identity. It shows observed movement, but it is coarser and later than raw AIS."],
  ["World wake", "A low-resolution field of cargo-vessel presence observed by Global Fishing Watch about four days earlier. It is historical density, not a set of live vessel positions."],
];

const sourceLinks = [
  ["AISStream", "Live terrestrial vessel messages", "https://aisstream.io/documentation.html"],
  ["Fintraffic Digitraffic", "Live Finnish and Baltic AIS positions · CC BY 4.0", "https://www.digitraffic.fi/en/marine-traffic/"],
  ["Norwegian Coastal Administration", "Open live AIS in Norwegian waters · NLOD", "https://www.kystverket.no/en/navigation-and-monitoring/ais/access-to-ais-data/"],
  ["AISHub", "Reciprocal global terrestrial AIS network under evaluation", "https://www.aishub.net/join-us"],
  ["Natural Earth", "Land and public map geometry", "https://www.naturalearthdata.com/"],
  ["Open-Meteo Marine", "Accessible marine model fields", "https://open-meteo.com/en/docs/marine-weather-api"],
  ["NSIDC Sea Ice Index", "Daily polar sea-ice concentration", "https://nsidc.org/data/seaice_index"],
  ["Global Fishing Watch", "Four-day-delayed global AIS presence and satellite radar detections", "https://globalfishingwatch.org/our-apis/documentation"],
  ["Panama Canal Authority", "Official advisories to shipping", "https://pancanal.com/en/maritime-services/advisory-to-shipping/"],
  ["IMB Piracy Reporting Centre", "Public incident map", "https://icc-ccs.org/map/"],
  ["World Bank Pink Sheet", "Monthly public commodity benchmarks", "https://www.worldbank.org/en/research/commodity-markets"],
];

export default function WikiPage() {
  return (
    <main className="wiki-shell">
      <header className="wiki-masthead">
        <Link className="wiki-brand" href="/"><span aria-hidden="true">✦</span> CARGO CONSTELLATIONS</Link>
        <nav aria-label="Field guide sections">
          <a href="#purpose">Purpose</a>
          <a href="#reading">Reading the globe</a>
          <a href="#layers">Data atlas</a>
          <a href="#language">Plain language</a>
        </nav>
        <Link className="return-world" href="/">RETURN TO THE WORLD →</Link>
      </header>

      <article className="wiki-article">
        <section className="wiki-hero" id="purpose">
          <p className="wiki-kicker">FIELD GUIDE · VOLUME 01</p>
          <h1>A world of trade,<br /><em>made legible.</em></h1>
          <p className="wiki-deck">Cargo Constellations is an atmospheric globe of the recent memory of ocean trade. Its primary view joins six days of identity-preserving cargo-vessel observations from approximately four days ago across five major shipping corridors, surrounded by optional live, environmental, risk, and commodity context. This guide explains what you are seeing, where it comes from, and where uncertainty begins.</p>
          <div className="wiki-hero-note">
            <span>THE CENTRAL PROMISE</span>
            <p>Every number is real, derived from a named observation, or visibly marked as demonstration data. Beauty should invite curiosity—not hide the limits of the evidence.</p>
          </div>
        </section>

        <section className="wiki-section" aria-labelledby="motivation-title">
          <div className="wiki-section-title"><span>01</span><div><p>MOTIVATION</p><h2 id="motivation-title">Why build this world?</h2></div></div>
          <div className="wiki-prose-grid">
            <p>The project began with a simple fascination: ordinary goods connect weather, geology, labor, ships, finance, and geography. Coffee in a cup, copper in a wire, or wheat in bread has crossed a landscape of ports, currents, borders, and prices.</p>
            <p>The visual references are <cite>Breath of the Wild</cite> and <cite>Ghost of Tsushima</cite>: worlds that are spacious, atmospheric, and understandable through attentive looking. Here, ports become named sanctuaries, weather becomes a visible presence, and received paths slowly draw constellations across the sea.</p>
          </div>
          <div className="principle-grid">
            {principles.map(([title, copy], index) => <div key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></div>)}
          </div>
        </section>

        <section className="wiki-section" id="reading" aria-labelledby="reading-title">
          <div className="wiki-section-title"><span>02</span><div><p>READING THE GLOBE</p><h2 id="reading-title">From global signals to ocean memory</h2></div></div>
          <div className="signal-story" aria-label="How vessel data reaches the globe">
            <div><b>1</b><strong>Ships leave signals</strong><p>Cargo and carrier vessels broadcast AIS positions across the world. Coverage varies with coastal and satellite reception.</p></div>
            <i aria-hidden="true">→</i>
            <div><b>2</b><strong>Identity survives the grid</strong><p>Global Fishing Watch publishes hourly gridded observations that retain a vessel identity for this bounded report.</p></div>
            <i aria-hidden="true">→</i>
            <div><b>3</b><strong>The horizon settles</strong><p>The latest complete global view arrives about four days later. The date is shown prominently because the delay is part of the meaning.</p></div>
            <i aria-hidden="true">→</i>
            <div><b>4</b><strong>The ocean remembers</strong><p>Ordered observations for the same cargo vessel become a gold constellation. Teal density remains optional context; crisp live lanterns appear only in the Nordic sample.</p></div>
          </div>
          <div className="truth-table">
            <div><span className="truth-symbol received" /><strong>Received</strong><p>Direct observation or official published record.</p></div>
            <div><span className="truth-symbol derived" /><strong>Derived</strong><p>Calculated from observations, with the method named.</p></div>
            <div><span className="truth-symbol modeled" /><strong>Modeled</strong><p>A scientific forecast or analysis field, not a local measurement.</p></div>
            <div><span className="truth-symbol demo" /><strong>Demonstration</strong><p>Synthetic data shaped like the real feed and labeled every time.</p></div>
          </div>
        </section>

        <section className="wiki-section" id="layers" aria-labelledby="layers-title">
          <div className="wiki-section-title"><span>03</span><div><p>DATA ATLAS</p><h2 id="layers-title">What each layer means</h2></div></div>
          <p className="section-intro">A layer may be directly observed, computed, modeled, or editorially curated. Its source and status are part of the interface—not fine print.</p>
          <div className="atlas-grid">
            {DATA_LAYERS.map((layer) => (
              <article key={layer.id} className={`atlas-card ${layer.status}`}>
                <div><span>{layer.status === "active" ? "AVAILABLE" : layer.status === "credential" ? "FREE KEY" : "PLANNED"}</span><i /></div>
                <h3>{layer.label}</h3>
                <p>{layer.description}</p>
                <small>SOURCE · {layer.source}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="wiki-section" aria-labelledby="limits-title">
          <div className="wiki-section-title"><span>04</span><div><p>UNCERTAINTY</p><h2 id="limits-title">What the globe cannot know</h2></div></div>
          <div className="limits-layout">
            <div className="limits-callout"><strong>Dark does not mean empty.</strong><p>Terrestrial AIS is a coastal radio system. A quiet ocean may mean no receiver heard the ship—not that no ship is there.</p></div>
            <ul>
              <li>AIS can be switched off, entered incorrectly, delayed, duplicated, or deliberately spoofed.</li>
              <li>A ship does not broadcast its cargo. Commodity labels are cautious inferences from vessel type, origin, destination, terminal, and draught.</li>
              <li>Radar detections unmatched to AIS are interesting, but they do not prove a vessel deliberately went dark.</li>
              <li>Weather and ocean fields are models sampled across large areas; they are not readings from each ship.</li>
              <li>AIS destinations are manually entered free text. A resolved port and great-circle path are interpretive context, not a captain&apos;s filed route.</li>
              <li>Colored delayed voyages join hourly grid cells for the same vessel. They show observed order, not the exact path between hours, and cover five bounded shipping corridors rather than every ocean cell.</li>
              <li>The optional Global Fishing Watch world wake is a low-resolution aggregate presence heatmap. It cannot identify or trace an individual ship.</li>
              <li>Public commodity benchmarks are monthly context. They are not live quotes or trading advice.</li>
            </ul>
          </div>
        </section>

        <section className="wiki-section" aria-labelledby="roadmap-title">
          <div className="wiki-section-title"><span>05</span><div><p>THE WORLD AHEAD</p><h2 id="roadmap-title">From wonder layer to quiet instrument</h2></div></div>
          <div className="roadmap-river">
            <div><span>NOW</span><h3>Remember</h3><p>Six-day, identity-preserving cargo histories across five major corridors are primary, with optional Nordic live traffic and contextual layers.</p></div>
            <div><span>NEXT</span><h3>Understand</h3><p>Persist successive corridor windows into longer voyage histories, connect port calls, and improve cautious commodity inference.</p></div>
            <div><span>LATER</span><h3>Act carefully</h3><p>Freight context, ETA reliability, and procurement timing—always separated from the contemplative globe.</p></div>
          </div>
          <p className="roadmap-note">This is the bridge to the build specification’s action layer: analytics should grow from an honest data model without remaking the world as a conventional dashboard.</p>
        </section>

        <section className="wiki-section" id="language" aria-labelledby="language-title">
          <div className="wiki-section-title"><span>06</span><div><p>PLAIN LANGUAGE</p><h2 id="language-title">A small maritime glossary</h2></div></div>
          <dl className="glossary-grid">{glossary.map(([term, meaning]) => <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>)}</dl>
        </section>

        <section className="wiki-section sources-section" aria-labelledby="sources-title">
          <div className="wiki-section-title"><span>07</span><div><p>PROVENANCE</p><h2 id="sources-title">Follow the evidence</h2></div></div>
          <div className="source-list">{sourceLinks.map(([name, use, url]) => <a key={name} href={url} target="_blank" rel="noreferrer"><span>{name}</span><p>{use}</p><b>↗</b></a>)}</div>
        </section>
      </article>

      <footer className="wiki-footer"><p>THE RECENT MEMORY OF GLOBAL TRADE</p><Link href="/">Open the globe</Link></footer>
    </main>
  );
}
