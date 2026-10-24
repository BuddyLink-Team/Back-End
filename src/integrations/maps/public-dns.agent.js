import dns from 'node:dns';
import https from 'node:https';
import logger from '../../shared/logger/index.js';

// Some ISP / router resolvers answer "non-existent domain" for the OpenStreetMap hosts
// (nominatim.openstreetmap.org, overpass instances). dns.setServers() does not help: HTTP clients use
// dns.lookup (the system resolver). This agent resolves with public DNS first, then the system resolver.
const PUBLIC_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
resolver.setServers(PUBLIC_DNS_SERVERS);

/**
 * dns.lookup compatible: public DNS (IPv4), falling back to the system resolver
 * (e.g. where outbound DNS to public servers is blocked)
 */
export const publicDnsLookup = (hostname, options, callback) => {
  const opts = typeof options === 'function' ? {} : options || {};
  const done = typeof options === 'function' ? options : callback;

  resolver.resolve4(hostname, (error, addresses) => {
    if (error || !addresses?.length) {
      logger.warn(`[PublicDns] ${hostname} not resolved by public DNS (${error?.code || 'no address'}), using the system resolver`);
      return dns.lookup(hostname, opts, done);
    }
    if (opts.all) return done(null, addresses.map((address) => ({ address, family: 4 })));
    return done(null, addresses[0], 4);
  });
};

/** HTTPS agent for the OpenStreetMap APIs, resolving their hosts with publicDnsLookup */
export const publicDnsHttpsAgent = new https.Agent({ keepAlive: true, lookup: publicDnsLookup });

export default publicDnsHttpsAgent;
