import requests, bs4, unidecode
url='https://www.henricssonsbatkapell.se/exempel/605-explorer'
resp=requests.get(url,timeout=30); resp.encoding='utf-8'; html=resp.text
soup=bs4.BeautifulSoup(html,'html.parser')
label=soup.select_one('.category-label')
print('Category label:', label.get_text(strip=True) if label else 'NONE')
print('Unidecode:', unidecode.unidecode(label.get_text(strip=True)) if label else 'NONE')
print('raw repr:', repr(label.get_text(strip=True)) if label else 'NONE') 