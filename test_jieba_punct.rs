use jieba_rs::Jieba; fn main() { let jieba = Jieba::new(); let text = "( )是大种素质中最基本的素质。"; let words = jieba.cut_for_search(text, true); println!("{:?}", words); }
