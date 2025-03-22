export default function ToDo() {
      return (
            <div className="h-screen bg-gradient-to-b from-gray-800 to-gray-700">
                  <h1 className="text-white font-bold text-3xl p-4">To do list</h1>
                  <div className="bg-[#6a7282aa] rounded-lg border-0 p-2 m-4">
                        <input type="radio" />
                        <label className="text-white"> Do laundry </label>
                  </div>
            </div>
      );
}
