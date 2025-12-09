use jieba_rs::Jieba; fn main() { let jieba = Jieba::new(); let words = jieba.cut_for_search("基本素质", true); println!("{:?}", words); let words2 = jieba.cut("基本素质", true); println!("{:?}", words2); }
