// 独立控制台程序，不加载 zerror_lib 或 CEF。
#[path = "../cli/client.rs"]
mod client;

fn main() {
    std::process::exit(client::main(std::env::args().skip(1).collect()));
}
