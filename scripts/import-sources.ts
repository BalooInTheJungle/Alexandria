// Import des 46 journaux scientifiques dans la table sources (Supabase)
// Usage : npx tsx scripts/import-sources.ts

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Lecture manuelle de .env.local
const envPath = resolve(process.cwd(), '.env.local')
readFileSync(envPath, 'utf8').split('\n').forEach(line => {
  const [key, ...rest] = line.split('=')
  if (key && !key.startsWith('#')) process.env[key.trim()] = rest.join('=').trim()
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SOURCES = [
  // ── ACS Publications ──────────────────────────────────────────────────────
  { name: 'Journal of the American Chemical Society', publisher: 'ACS', issn: '1520-5126', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jacsat',  source_type: 'rss', url: 'https://pubs.acs.org/journal/jacsat' },
  { name: 'Chemistry of Materials',                   publisher: 'ACS', issn: '1520-5002', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=cmatex',  source_type: 'rss', url: 'https://pubs.acs.org/journal/cmatex' },
  { name: 'Inorganic Chemistry',                      publisher: 'ACS', issn: '1520-510X', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=inocaj',  source_type: 'rss', url: 'https://pubs.acs.org/journal/inocaj' },
  { name: 'ACS Nano',                                 publisher: 'ACS', issn: '1936-086X', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=ancac3',  source_type: 'rss', url: 'https://pubs.acs.org/journal/ancac3' },
  { name: 'Crystal Growth & Design',                  publisher: 'ACS', issn: '1528-7505', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=cgdefu',  source_type: 'rss', url: 'https://pubs.acs.org/journal/cgdefu' },
  { name: 'ACS Applied Materials & Interfaces',       publisher: 'ACS', issn: '1944-8252', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=aamick',  source_type: 'rss', url: 'https://pubs.acs.org/journal/aamick' },
  { name: 'ACS Applied Optical Materials',            publisher: 'ACS', issn: '2771-9855', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=aaoma6',  source_type: 'rss', url: 'https://pubs.acs.org/journal/aaoma6' },
  { name: 'Nano Letters',                             publisher: 'ACS', issn: '1530-6992', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=nalefd',  source_type: 'rss', url: 'https://pubs.acs.org/journal/nalefd' },
  { name: 'Journal of Physical Chemistry Letters',    publisher: 'ACS', issn: '1948-7185', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jpclcd',  source_type: 'rss', url: 'https://pubs.acs.org/journal/jpclcd' },
  { name: 'ACS Central Science',                      publisher: 'ACS', issn: '2374-7951', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=acscii',  source_type: 'rss', url: 'https://pubs.acs.org/journal/acscii' },
  { name: 'Chemical Reviews',                         publisher: 'ACS', issn: '1520-6890', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=chreay',  source_type: 'rss', url: 'https://pubs.acs.org/journal/chreay' },
  { name: 'Accounts of Chemical Research',            publisher: 'ACS', issn: '1520-4898', rss_url: 'https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=achre4',  source_type: 'rss', url: 'https://pubs.acs.org/journal/achre4' },

  // ── RSC ───────────────────────────────────────────────────────────────────
  { name: 'Chemical Science',             publisher: 'RSC', issn: '2041-6539', rss_url: 'https://pubs.rsc.org/en/rss/journal/sc', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/sc' },
  { name: 'Chemical Communications',      publisher: 'RSC', issn: '1364-548X', rss_url: 'https://pubs.rsc.org/en/rss/journal/cc', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/cc' },
  { name: 'Dalton Transactions',          publisher: 'RSC', issn: '1477-9234', rss_url: 'https://pubs.rsc.org/en/rss/journal/dt', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/dt' },
  { name: 'Journal of Materials Chemistry A', publisher: 'RSC', issn: '2050-7496', rss_url: 'https://pubs.rsc.org/en/rss/journal/ta', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/ta' },
  { name: 'Journal of Materials Chemistry B', publisher: 'RSC', issn: '2050-7504', rss_url: 'https://pubs.rsc.org/en/rss/journal/tb', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/tb' },
  { name: 'Journal of Materials Chemistry C', publisher: 'RSC', issn: '2050-7526', rss_url: 'https://pubs.rsc.org/en/rss/journal/tc', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/tc' },
  { name: 'Inorganic Chemistry Frontiers', publisher: 'RSC', issn: '2052-1553', rss_url: 'https://pubs.rsc.org/en/rss/journal/qi', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/qi' },
  { name: 'CrystEngComm',                 publisher: 'RSC', issn: '1466-8033', rss_url: 'https://pubs.rsc.org/en/rss/journal/ce', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/ce' },
  { name: 'New Journal of Chemistry',     publisher: 'RSC', issn: '1369-9261', rss_url: 'https://pubs.rsc.org/en/rss/journal/nj', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/nj' },
  { name: 'Chemical Society Reviews',     publisher: 'RSC', issn: '1460-4744', rss_url: 'https://pubs.rsc.org/en/rss/journal/cs', source_type: 'rss', url: 'https://pubs.rsc.org/en/journals/journal/cs' },

  // ── Wiley / Chemistry Europe ──────────────────────────────────────────────
  { name: 'Angewandte Chemie International Edition', publisher: 'Wiley', issn: '1521-3773', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=15213773&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/15213773' },
  { name: 'Chemistry – A European Journal',          publisher: 'Wiley', issn: '1521-3765', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=15213765&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/15213765' },
  { name: 'European Journal of Inorganic Chemistry', publisher: 'Wiley', issn: '1099-0682', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=10990682&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/10990682' },
  { name: 'Advanced Materials',                      publisher: 'Wiley', issn: '1521-4095', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=15214095&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/15214095' },
  { name: 'Advanced Functional Materials',           publisher: 'Wiley', issn: '1616-3028', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=16163028&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/16163028' },
  { name: 'Small',                                   publisher: 'Wiley', issn: '1613-6829', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=16136829&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/16136829' },
  { name: 'ChemistryEurope',                         publisher: 'Wiley', issn: '2751-4765', rss_url: 'https://onlinelibrary.wiley.com/action/showFeed?jc=27514765&type=etoc&feed=rss', source_type: 'rss', url: 'https://onlinelibrary.wiley.com/journal/27514765' },

  // ── Nature Portfolio ──────────────────────────────────────────────────────
  { name: 'Nature Chemistry',      publisher: 'Nature', issn: '1755-4349', rss_url: 'https://www.nature.com/nchem.rss',        source_type: 'rss', url: 'https://www.nature.com/nchem' },
  { name: 'Nature Materials',      publisher: 'Nature', issn: '1476-4660', rss_url: 'https://www.nature.com/nmat.rss',         source_type: 'rss', url: 'https://www.nature.com/nmat' },
  { name: 'Nature Communications', publisher: 'Nature', issn: '2041-1723', rss_url: 'https://www.nature.com/ncomms.rss',       source_type: 'rss', url: 'https://www.nature.com/ncomms' },
  { name: 'npj Quantum Materials', publisher: 'Nature', issn: '2397-4648', rss_url: 'https://www.nature.com/npjquantmats.rss', source_type: 'rss', url: 'https://www.nature.com/npjquantmats' },

  // ── APS ───────────────────────────────────────────────────────────────────
  { name: 'Physical Review B',         publisher: 'APS', issn: '2469-9969', rss_url: 'https://feeds.aps.org/rss/recent/prb.xml',         source_type: 'rss', url: 'https://journals.aps.org/prb' },
  { name: 'Physical Review Letters',   publisher: 'APS', issn: '1079-7114', rss_url: 'https://feeds.aps.org/rss/recent/prl.xml',         source_type: 'rss', url: 'https://journals.aps.org/prl' },
  { name: 'Physical Review Materials', publisher: 'APS', issn: '2475-9953', rss_url: 'https://feeds.aps.org/rss/recent/prmaterials.xml', source_type: 'rss', url: 'https://journals.aps.org/prmaterials' },

  // ── Elsevier / ScienceDirect ──────────────────────────────────────────────
  { name: 'Coordination Chemistry Reviews',        publisher: 'Elsevier', issn: '1873-3840', rss_url: 'https://rss.sciencedirect.com/publication/science/00108545', source_type: 'rss', url: 'https://www.sciencedirect.com/journal/coordination-chemistry-reviews' },
  { name: 'Journal of Magnetism and Magnetic Materials', publisher: 'Elsevier', issn: '1873-4766', rss_url: 'https://rss.sciencedirect.com/publication/science/03048853', source_type: 'rss', url: 'https://www.sciencedirect.com/journal/journal-of-magnetism-and-magnetic-materials' },
  { name: 'Polyhedron',                            publisher: 'Elsevier', issn: '0277-5387', rss_url: 'https://rss.sciencedirect.com/publication/science/02775387', source_type: 'rss', url: 'https://www.sciencedirect.com/journal/polyhedron' },
  { name: 'Inorganica Chimica Acta',               publisher: 'Elsevier', issn: '1873-3255', rss_url: 'https://rss.sciencedirect.com/publication/science/00201693', source_type: 'rss', url: 'https://www.sciencedirect.com/journal/inorganica-chimica-acta' },
  { name: 'Materials Today',                       publisher: 'Elsevier', issn: '1369-7021', rss_url: 'https://rss.sciencedirect.com/publication/science/13697021', source_type: 'rss', url: 'https://www.sciencedirect.com/journal/materials-today' },

  // ── MDPI ──────────────────────────────────────────────────────────────────
  { name: 'Magnetochemistry', publisher: 'MDPI', issn: '2312-7481', rss_url: 'https://www.mdpi.com/rss/journal/magnetochemistry', source_type: 'rss', url: 'https://www.mdpi.com/journal/magnetochemistry' },
  { name: 'Inorganics',       publisher: 'MDPI', issn: '2304-6740', rss_url: 'https://www.mdpi.com/rss/journal/inorganics',       source_type: 'rss', url: 'https://www.mdpi.com/journal/inorganics' },

  // ── AAAS / NAS ────────────────────────────────────────────────────────────
  { name: 'Science', publisher: 'AAAS', issn: '1095-9203', rss_url: 'https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science', source_type: 'rss', url: 'https://www.science.org/journal/science' },
  { name: 'PNAS',    publisher: 'NAS',  issn: '1091-6490', rss_url: 'https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas',      source_type: 'rss', url: 'https://www.pnas.org' },
]

async function main() {
  console.log('[import-sources] Starting import of', SOURCES.length, 'journals')

  let inserted = 0
  let updated = 0
  let errors = 0

  for (const source of SOURCES) {
    const { data, error } = await supabase
      .from('sources')
      .upsert(source, { onConflict: 'issn', ignoreDuplicates: false })
      .select('id, name')

    if (error) {
      console.error('[import-sources] Error on', source.name, ':', error.message)
      errors++
      continue
    }

    console.log('[import-sources] OK :', source.name)
    inserted++
  }

  console.log('\n[import-sources] Done.')
  console.log('[import-sources] Inserted/updated:', inserted, '| Errors:', errors)
}

main()
