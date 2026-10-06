package server

import (
	"net/http"
	"net/netip"
	"slices"
	"strings"
)

// trustProxies strips X-Forwarded-* unless the TCP peer is a configured proxy;
// for a trusted peer it sets RemoteAddr to the real client from X-Forwarded-For
// (the rightmost hop that isn't itself a trusted proxy).
func trustProxies(trusted []netip.Prefix, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isTrusted(trusted, r.RemoteAddr) {
			for _, h := range []string{"Forwarded", "X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "X-Forwarded-Port", "X-Real-Ip"} {
				r.Header.Del(h)
			}
		} else if client, ok := clientFromXFF(trusted, r.Header.Values("X-Forwarded-For")); ok {
			r.RemoteAddr = netip.AddrPortFrom(client, 0).String()
		}
		next.ServeHTTP(w, r)
	})
}

func isTrusted(trusted []netip.Prefix, remoteAddr string) bool {
	ap, err := netip.ParseAddrPort(remoteAddr)
	if err != nil {
		return false
	}
	return contains(trusted, ap.Addr())
}

func contains(trusted []netip.Prefix, a netip.Addr) bool {
	a = a.Unmap()
	return slices.ContainsFunc(trusted, func(p netip.Prefix) bool { return p.Contains(a) })
}

func clientFromXFF(trusted []netip.Prefix, values []string) (netip.Addr, bool) {
	hops := strings.Split(strings.Join(values, ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		a, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			return netip.Addr{}, false
		}
		if !contains(trusted, a) {
			return a.Unmap(), true
		}
	}
	return netip.Addr{}, false
}
