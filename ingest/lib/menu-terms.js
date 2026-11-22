// Curated vocabulary for menuFromText. Each entry is "canonical|variant|variant": the first is what we
// store (lowercase), the rest are spellings and plurals that map to it.
// FLAVORS can take a drink or dessert word after them ("strawberry matcha latte", "ube soft serve").
export const FLAVORS = [
  "strawberry|strawberries", "mango|mangoes|mangos", "ube", "coconut", "yuzu", "black sesame|sesame",
  "brown sugar", "honey", "lavender", "rose", "peach|peaches", "blueberry|blueberries", "banana|bananas",
  "pistachio", "hojicha|houjicha|hoji", "genmaicha|genmai", "vanilla", "caramel", "salted caramel", "chocolate",
  "cherry|cherries", "raspberry|raspberries", "lemon", "orange", "pineapple", "watermelon", "cucumber", "mint",
  "ginger", "cinnamon", "pumpkin spice", "pumpkin", "maple", "red bean|azuki|anko", "kinako", "sakura",
  "oat", "almond", "hazelnut", "espresso", "dirty", "sparkling", "iced", "cloud", "taro", "cookies and cream",
  "coconut cream", "yuzu honey", "apple", "pear", "melon", "lychee", "passion fruit|passionfruit", "grapefruit",
];
// Standalone menu items.
export const ITEMS = [
  "einspanner|einspänner|einspaenner", "tonic", "lemonade", "affogato", "soft serve|softserve", "mochi",
  "cookie|cookies", "croissant|croissants", "shaved ice|kakigori", "tiramisu", "cheesecake", "latte|lattes",
  "cold brew", "ceremonial", "usucha", "koicha", "cold foam", "matcha shot|matcha shots", "ice cream", "gelato",
  "boba|bubble tea|tapioca pearls", "taiyaki", "dango", "daifuku", "donut|donuts|doughnut|doughnuts",
  "pastry|pastries", "scone|scones", "brownie|brownies", "waffle|waffles", "parfait|parfaits", "cupcake|cupcakes",
  "macaron|macarons", "muffin|muffins", "cake|cakes", "kombucha", "chai", "cortado", "cappuccino",
  "tea set|tea sets", "matcha bowl|matcha bowls", "sparkling matcha", "iced matcha", "hot matcha",
  "matcha flight|matcha flights", "milk tea", "bubble waffle", "cream puff|cream puffs", "madeleine|madeleines",
  "roll cake", "sando|sandos", "onigiri", "yakitori", "ramen", "dumpling|dumplings",
];
// Words that can follow a flavor to make a menu item.
export const SUFFIXES = [
  "matcha latte", "matcha", "latte", "tonic", "lemonade", "soft serve", "ice cream", "cold foam", "cold brew",
  "shaved ice", "mochi", "cookie", "cookies", "croissant", "cheesecake", "tiramisu", "affogato", "cake", "donut",
  "einspanner", "boba",
];
// Words that look like list items but are not.
export const NOT_ITEMS = /^(more|etc|and more|all|everything|plus|today|this week|drinks?|treats?|goodies|specials?|surprises?|sweets?)$/i;
// Flavors that only count with a following word ("oat" alone is not a menu item).
export const NEEDS_SUFFIX = new Set(["oat", "almond", "hazelnut", "espresso", "dirty", "sparkling", "iced", "cloud", "orange", "mint", "ginger", "apple", "pear", "melon", "cinnamon", "maple", "rose"]);
