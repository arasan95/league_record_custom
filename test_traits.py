import urllib.request
def check(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        r = urllib.request.urlopen(req)
        print('OK:', url, r.getcode())
    except Exception as e:
        print('FAIL:', url, e)

check('https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_16_yordle.tft_set16.png')
check('https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_16_longshot.tft_set16.png')
check('https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_16_sorcerer.tft_set16.png')
check('https://raw.communitydragon.org/latest/game/assets/ux/traiticons/trait_icon_16_demacia.tft_set16.png')
