export type ProfileEffectCatalogItem = {
  id: string
  name: string
  mediaUrl: string
  price: 2000
}

// User-supplied Discord collectible media. The duplicated e306e4... URL was
// intentionally de-duplicated so the same effect is never sold twice.
const URLS = [
  "https://cdn.discordapp.com/media/v1/collectibles-shop/3b74ba84c8941ad0d91afafd00d169b8124cd2956fcaa7fda3b784a6edafcba6",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/41bdd75fdbffcb851d65825cd0f6a13d2876d29c145b888074c0af55b7dfba9c",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/a5d939bee2b05ef76803472b5b8ecc27da965997fce90fc8f9e58d43c9f8970e",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/cd4313e497939cbb41a6a0bc136de9126ce3ab8e69e966caf062fb3e984f24fc",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/c6a804dacf39134b31719166fdf0debfb208c2284ef9aaa0d7a8db670405a092",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/728f0c927b5b50a012f73d81783e7814f9b5fea6d9aa4746ab2025081f968afe",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/84168a5adc7db3805121683b85f398b21ebfd9e0396bc9a2bbf70591acb482fb",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/b4d8e2fcad0a9558d6a1a8160696a29d65c45a58ae421f85e5fee1e88f40f0e8",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/2884b01ea871d48b778e75b202fdb6d2f766b3adba3ae695915c4e4b3be9c322",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/124a87da4f276710bc6f24a9990ef62f1f5e1d6a6c81237c3fa632dbf713aced",
  "https://cdn.discordapp.com/assets/content/e306e4ac3b1fa6bd141077675f38a4e587b06b7cacf1c1f6df9ab903aa2738e8",
  "https://cdn.discordapp.com/assets/content/2efaf1202e1633579f7f29df1cb942e678054ec69381945ce2fc03c902dfa5ed",
  "https://cdn.discordapp.com/media/v1/collectibles-shop/c2f198baf0e91a0cb467a2102b461bd472c662b18fa93f307e8860bf5d2cdda0",
  "https://cdn.discordapp.com/assets/content/3507e936802583b79c956d08db8babd92b183f7006a28457aba9f778910e7201",
  "https://cdn.discordapp.com/assets/content/0cddef18d8e928cb58064334b5b66e2e89fecf3e60b585d992b3c587ffef8342",
  "https://cdn.discordapp.com/assets/content/46fbdfd57cdc5ccc55d43678c41505e9955241281a79aed563cc3cc5079829ab",
  "https://cdn.discordapp.com/assets/content/00f5603ad5a4ebfa362eab5538be5d1d8dd0206f175beb876644da3877bdf827",
  "https://cdn.discordapp.com/assets/content/05a494f1ee6675d460c9b8e98b1cfd1d6405b0b7cab6a11b421143d165e853b1",
  "https://cdn.discordapp.com/assets/content/ef712ffa98bcc1c39cceb2f14e3e0c759ae2712055adce234c524c2d5eb873d3",
  "https://cdn.discordapp.com/assets/content/1fd42359e3101e5e23b62ead61648908dae8490d7f39d04c63e00de7b38e22c3",
  "https://cdn.discordapp.com/assets/content/11dbba8e43117d6955a3c9b3691cf2c1d145f785b51ff1bf84e83ce13719f58d",
  "https://cdn.discordapp.com/assets/content/fb531b323f3fdb4df0eae1c99da9994b868fb5b8609b1bc7109d48e01f2a5c8d",
  "https://cdn.discordapp.com/assets/content/ecea664ef80c21a0c01ade8e4eb4b5bbb38f473103e84f9bfb111dadbfe2a419",
] as const

export const PROFILE_EFFECTS: ProfileEffectCatalogItem[] = URLS.map((mediaUrl, index) => ({
  id: `profile-effect-${String(index + 1).padStart(2, "0")}`,
  name: `Profile Effect ${String(index + 1).padStart(2, "0")}`,
  mediaUrl,
  price: 2000,
}))

export const PROFILE_EFFECT_IDS = new Set(PROFILE_EFFECTS.map((item) => item.id))

export function getProfileEffect(id: string | null | undefined) {
  return id ? PROFILE_EFFECTS.find((item) => item.id === id) || null : null
}
